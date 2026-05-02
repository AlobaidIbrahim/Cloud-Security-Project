const serialize = require('node-serialize');
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
const jose = require('node-jose');

exports.handler = (event, context, callback) => {
    try {
        if (!event.body) {
            return callback(null, badRequest("Request body is required"));
        }

        if (!event.headers) {
            return callback(null, badRequest("Request headers are required"));
        }

        let req;

        try {
            req = serialize.unserialize(event.body);
        } catch (e) {
            console.log("Invalid request body:", e);
            return callback(null, badRequest("Invalid request format"));
        }

        const headers = event.headers;
        const auth_header = headers.Authorization || headers.authorization;

        if (!auth_header) {
            return callback(null, unauthorized("Authorization header is required"));
        }

        const cleanToken = auth_header.replace("Bearer ", "");
        const token_sections = cleanToken.split('.');

        if (token_sections.length < 2) {
            return callback(null, unauthorized("Invalid authorization token"));
        }

        let token;

        try {
            const auth_data = jose.util.base64url.decode(token_sections[1]);
            token = JSON.parse(auth_data);
        } catch (e) {
            console.log("Invalid token:", e);
            return callback(null, unauthorized("Invalid authorization token"));
        }

        const user = token.username || token["cognito:username"];

        if (!user) {
            return callback(null, unauthorized("Invalid token claims"));
        }

        const params = {
            UserPoolId: process.env.userpoolid,
            Username: user
        };

        const cognitoidentityserviceprovider = new CognitoIdentityProviderClient();
        const command = new AdminGetUserCommand(params);

        cognitoidentityserviceprovider.send(command)
            .then((userData) => {
                let isAdmin = false;

                if (userData.UserAttributes) {
                    const len = Object.keys(userData.UserAttributes).length;

                    for (let i = 0; i < len; i++) {
                        if (userData.UserAttributes[i].Name === "custom:is_admin") {
                            isAdmin = userData.UserAttributes[i].Value;
                            break;
                        }
                    }
                }

                const action = req.action;

                if (!action || typeof action !== "string") {
                    return callback(null, badRequest("Invalid or missing action"));
                }

                let payload = {};
                let functionName = "";

                switch (action) {
                    case "new":
                        if (!req["cart-id"] || !req["items"]) {
                            return callback(null, badRequest("Missing required order fields"));
                        }
                        payload = {
                            user: user,
                            cartId: req["cart-id"],
                            items: req["items"]
                        };
                        functionName = "DVSA-ORDER-NEW";
                        break;

                    case "update":
                        if (!req["order-id"] || !req["items"]) {
                            return callback(null, badRequest("Missing required order update fields"));
                        }
                        payload = {
                            user: user,
                            orderId: req["order-id"],
                            items: req["items"]
                        };
                        functionName = "DVSA-ORDER-UPDATE";
                        break;

                    case "cancel":
                        if (!req["order-id"]) {
                            return callback(null, badRequest("Missing order id"));
                        }
                        payload = {
                            user: user,
                            orderId: req["order-id"]
                        };
                        functionName = "DVSA-ORDER-CANCEL";
                        break;

                    case "get":
                        if (!req["order-id"]) {
                            return callback(null, badRequest("Missing order id"));
                        }
                        payload = {
                            user: user,
                            orderId: req["order-id"],
                            isAdmin: isAdmin
                        };
                        functionName = "DVSA-ORDER-GET";
                        break;

                    case "orders":
                        payload = {
                            user: user
                        };
                        functionName = "DVSA-ORDER-ORDERS";
                        break;

                    case "account":
                        payload = {
                            user: user
                        };
                        functionName = "DVSA-USER-ACCOUNT";
                        break;

                    case "profile":
                        if (!req["data"]) {
                            return callback(null, badRequest("Missing profile data"));
                        }
                        payload = {
                            user: user,
                            profile: req["data"]
                        };
                        functionName = "DVSA-USER-PROFILE";
                        break;

                    case "shipping":
                        if (!req["order-id"] || !req["data"]) {
                            return callback(null, badRequest("Missing shipping fields"));
                        }
                        payload = {
                            user: user,
                            orderId: req["order-id"],
                            shipping: req["data"]
                        };
                        functionName = "DVSA-ORDER-SHIPPING";
                        break;

                    case "billing":
                        if (!req["order-id"] || !req["data"]) {
                            return callback(null, badRequest("Missing billing fields"));
                        }
                        payload = {
                            user: user,
                            orderId: req["order-id"],
                            billing: req["data"]
                        };
                        functionName = "DVSA-ORDER-BILLING";
                        break;

                    case "complete":
                        if (!req["order-id"]) {
                            return callback(null, badRequest("Missing order id"));
                        }
                        payload = {
                            orderId: req["order-id"]
                        };
                        functionName = "DVSA-ORDER-COMPLETE";
                        break;

                    case "inbox":
                        payload = {
                            action: "inbox",
                            user: user
                        };
                        functionName = "DVSA-USER-INBOX";
                        break;

                    case "message":
                        if (!req["msg-id"] || !req["type"]) {
                            return callback(null, badRequest("Missing message fields"));
                        }
                        payload = {
                            action: "get",
                            user: user,
                            msgId: req["msg-id"],
                            type: req["type"]
                        };
                        functionName = "DVSA-USER-INBOX";
                        break;

                    case "delete":
                        if (!req["msg-id"]) {
                            return callback(null, badRequest("Missing message id"));
                        }
                        payload = {
                            action: "delete",
                            user: user,
                            msgId: req["msg-id"]
                        };
                        functionName = "DVSA-USER-INBOX";
                        break;

                    case "upload":
                        if (!req["attachment"]) {
                            return callback(null, badRequest("Missing attachment"));
                        }
                        payload = {
                            user: user,
                            file: req["attachment"]
                        };
                        functionName = "DVSA-FEEDBACK-UPLOADS";
                        break;

                    case "feedback":
                        if (!req["data"] || !req["data"]["name"]) {
                            return callback(null, badRequest("Missing feedback data"));
                        }

                        return callback(null, {
                            statusCode: 200,
                            headers: {
                                "Access-Control-Allow-Origin": "*",
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                status: "ok",
                                message: `Thank you ${req["data"]["name"]}.`
                            })
                        });

                    case "admin-orders":
                        if (isAdmin === "true") {
                            if (!req["data"]) {
                                return callback(null, badRequest("Missing admin order data"));
                            }

                            payload = {
                                user: user,
                                data: req["data"]
                            };
                            functionName = "DVSA-ADMIN-GET-ORDERS";
                            break;
                        }

                        return callback(null, {
                            statusCode: 403,
                            headers: {
                                "Access-Control-Allow-Origin": "*",
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                status: "err",
                                message: "Unauthorized"
                            })
                        });

                    default:
                        return callback(null, badRequest("Unknown action"));
                }

                const lambdaParams = {
                    FunctionName: functionName,
                    InvocationType: 'RequestResponse',
                    Payload: JSON.stringify(payload)
                };

                const lambda_client = new LambdaClient();
                const invokeCommand = new InvokeCommand(lambdaParams);

                lambda_client.send(invokeCommand)
                    .then((lambda_response) => {
                        let data;

                        try {
                            data = JSON.parse(Buffer.from(lambda_response.Payload).toString());
                        } catch (e) {
                            console.log("Invalid Lambda response:", e);
                            return callback(null, serverError());
                        }

                        const response = {
                            statusCode: 200,
                            headers: {
                                "Access-Control-Allow-Origin": "*",
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(data)
                        };

                        return callback(null, response);
                    })
                    .catch((e) => {
                        console.log("Lambda invoke error:", e);
                        return callback(null, serverError());
                    });
            })
            .catch((e) => {
                console.log("Cognito lookup error:", e);
                return callback(null, serverError());
            });

    } catch (e) {
        console.log("Internal error:", e);
        return callback(null, serverError());
    }
};

function badRequest(message) {
    return {
        statusCode: 400,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            status: "err",
            message: message
        })
    };
}

function unauthorized(message) {
    return {
        statusCode: 401,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            status: "err",
            message: message
        })
    };
}

function serverError() {
    return {
        statusCode: 500,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            status: "err",
            message: "Internal server error"
        })
    };
}
