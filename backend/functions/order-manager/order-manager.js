// --- CHANGES FOR LESSONS 1, 2, AND 3 ---
// Lesson 1: Removed 'node-serialize' to prevent Event Injection (RCE).
// Lesson 2: Added 'verifyCognitoJwt' to fix Broken Authentication via JWT signature verification.
// Lesson 3: Combined fixes to prevent lateral movement and Sensitive Information Disclosure.

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
const jose = require('node-jose');
const https = require('https');

// Cache for Cognito Public Keys to improve performance
let _jwksCache = { keystore: null, fetchedAt: 0 };

/**
 * Helper to format API Gateway responses
 */
function resp(statusCode, bodyObj) {
    return {
        statusCode,
        headers: { 
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyObj)
    };
}

/**
 * Helper to fetch JSON data via HTTPS (Used for JWKS)
 */
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = "";
            res.on("data", (c) => data += c);
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                }
            });
        }).on("error", reject);
    });
}

/**
 * Fix for Lesson 2: Retrieves and caches Cognito Public Keys
 */
async function getCognitoKeystore() {
    const now = Date.now();
    // Cache keys for 6 hours
    if (_jwksCache.keystore && (now - _jwksCache.fetchedAt) < 6 * 60 * 60 * 1000) {
        return _jwksCache.keystore;
    }
    const region = process.env.AWS_REGION;
    const userPoolId = process.env.userpoolid;
    const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;

    const jwks = await fetchJson(jwksUrl);
    const keystore = await jose.JWK.asKeyStore(jwks);
    _jwksCache = { keystore, fetchedAt: now };
    return keystore;
}

/**
 * Fix for Lesson 2: Verifies the JWT signature and claims
 */
async function verifyCognitoJwt(jwt) {
    const region = process.env.AWS_REGION;
    const userPoolId = process.env.userpoolid;
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

    const keystore = await getCognitoKeystore();
    // Verify signature
    const result = await jose.JWS.createVerify(keystore).verify(jwt);
    const claims = JSON.parse(result.payload.toString("utf8"));

    // Verify claims
    if (claims.iss !== issuer) throw new Error("bad issuer");
    if (typeof claims.exp === "number" && (Date.now() / 1000) > claims.exp) throw new Error("expired");

    return claims;
}

exports.handler = (event, context, callback) => {
    // Fix for Lesson 1: Using native JSON.parse instead of node-serialize
    var req;
    try {
        req = JSON.parse(event.body);
    } catch (e) {
        return callback(null, resp(400, { status: "err", msg: "Invalid request format" }));
    }

    var headers = event.headers || {};
    var auth_header = (headers.Authorization || headers.authorization || "");
    var jwt = auth_header.replace(/^Bearer\s+/i, "").trim();

    if (!jwt) {
        return callback(null, resp(401, { status: "err", msg: "missing authorization" }));
    }

    // Fix for Lesson 2 & 3: Only proceed if token is cryptographically verified
    verifyCognitoJwt(jwt).then((claims) => {
        var user = claims.username || claims["cognito:username"] || claims.sub;
        
        if (!user) {
            return callback(null, resp(401, { status: "err", msg: "missing subject" }));
        }

        var isAdmin = false;
        var params = {
            UserPoolId: process.env.userpoolid,
            Username: user
        };

        const cognitoidentityserviceprovider = new CognitoIdentityProviderClient();
        const command = new AdminGetUserCommand(params);

        return cognitoidentityserviceprovider.send(command).then((userData) => {
            // Extract admin status safely
            if (userData.UserAttributes) {
                var len = userData.UserAttributes.length;
                for (var i = 0; i < len; i++) {
                    if (userData.UserAttributes[i].Name === "custom:is_admin") {
                        isAdmin = userData.UserAttributes[i].Value;
                        break;
                    }
                }
            }

            var action = req.action;
            var isOk = true;
            var payload = {};
            var functionName = "";

            // Routing logic
            switch (action) {
                case "new":
                    payload = { "user": user, "cartId": req["cart-id"], "items": req["items"] };
                    functionName = "DVSA-ORDER-NEW";
                    break;
                case "orders":
                    payload = { "user": user };
                    functionName = "DVSA-ORDER-ORDERS";
                    break;
                case "get":
                    payload = { "user": user, "orderId": req["order-id"], "isAdmin": isAdmin };
                    functionName = "DVSA-ORDER-GET";
                    break;
                default:
                    isOk = false;
            }

            if (isOk) {
                var invokeParams = {
                    FunctionName: functionName,
                    InvocationType: 'RequestResponse',
                    Payload: JSON.stringify(payload)
                };

                const lambda_client = new LambdaClient();
                const invokeCommand = new InvokeCommand(invokeParams);

                return lambda_client.send(invokeCommand).then((lambda_response) => {
                    const data = JSON.parse(Buffer.from(lambda_response.Payload).toString());
                    callback(null, resp(200, data));
                });
            } else {
                callback(null, resp(400, { "status": "err", "msg": "unknown action" }));
            }
        });
    }).catch((e) => {
        console.log("Security Error:", e);
        return callback(null, resp(401, { status: "err", msg: "invalid token" }));
    });
};
