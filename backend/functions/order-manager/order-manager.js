const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require("@aws-sdk/client-cognito-identity-provider");

function parseJsonMaybe(value, fallback = {}) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    throw new Error("Invalid JSON input type");
  }
  return JSON.parse(value);
}

function decodeJwtPayloadWithoutDependency(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Missing authorization token");
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Malformed JWT");
  }

  const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payloadJson);
}

exports.handler = async (event, context, callback) => {
  try {
    const req = parseJsonMaybe(event.body, {});
    const headers = parseJsonMaybe(event.headers, {});
    const authHeader = headers.Authorization || headers.authorization;

    const token = decodeJwtPayloadWithoutDependency(authHeader);
    const user = token.username;

    if (!user) {
      throw new Error("Missing username in token payload");
    }

    let isAdmin = false;
    const cognitoClient = new CognitoIdentityProviderClient();
    const command = new AdminGetUserCommand({
      UserPoolId: process.env.userpoolid,
      Username: user
    });

    const userData = await cognitoClient.send(command);
    const attrs = userData.UserAttributes || [];

    for (let i = 0; i < attrs.length; i++) {
      if (attrs[i].Name === "custom:is_admin") {
        isAdmin = attrs[i].Value;
        break;
      }
    }

    const action = req.action;
    let isOk = true;
    let payload = {};
    let functionName = "";

    switch (action) {
      case "new":
        payload = { user, cartId: req["cart-id"], items: req["items"] };
        functionName = "DVSA-ORDER-NEW";
        break;
      case "update":
        payload = { user, orderId: req["order-id"], items: req["items"] };
        functionName = "DVSA-ORDER-UPDATE";
        break;
      case "cancel":
        payload = { user, orderId: req["order-id"] };
        functionName = "DVSA-ORDER-CANCEL";
        break;
      case "get":
        payload = { user, orderId: req["order-id"], isAdmin };
        functionName = "DVSA-ORDER-GET";
        break;
      case "orders":
        payload = { user };
        functionName = "DVSA-ORDER-ORDERS";
        break;
      case "account":
        payload = { user };
        functionName = "DVSA-USER-ACCOUNT";
        break;
      case "profile":
        payload = { user, profile: req["data"] };
        functionName = "DVSA-USER-PROFILE";
        break;
      case "shipping":
        payload = { user, orderId: req["order-id"], shipping: req["data"] };
        functionName = "DVSA-ORDER-SHIPPING";
        break;
      case "billing":
        payload = { user, orderId: req["order-id"], billing: req["data"] };
        functionName = "DVSA-ORDER-BILLING";
        break;
      case "complete":
        payload = { orderId: req["order-id"] };
        functionName = "DVSA-ORDER-COMPLETE";
        break;
      case "inbox":
        payload = { action: "inbox", user };
        functionName = "DVSA-USER-INBOX";
        break;
      case "message":
        payload = { action: "get", user, msgId: req["msg-id"], type: req["type"] };
        functionName = "DVSA-USER-INBOX";
        break;
      case "delete":
        payload = { action: "delete", user, msgId: req["msg-id"] };
        functionName = "DVSA-USER-INBOX";
        break;
      case "upload":
        payload = { user, file: req["attachment"] };
        functionName = "DVSA-FEEDBACK-UPLOADS";
        break;
      case "feedback": {
        const response = {
          statusCode: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            status: "ok",
            message: `Thank you ${req["data"]["name"]}.`
          })
        };
        callback(null, response);
        return;
      }
      case "admin-orders":
        if (isAdmin === "true") {
          payload = { user, data: req["data"] };
          functionName = "DVSA-ADMIN-GET-ORDERS";
          break;
        }
        callback(null, {
          statusCode: 403,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ status: "err", message: "Unauthorized" })
        });
        return;
      default:
        isOk = false;
    }

    if (!isOk) {
      callback(null, {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ status: "err", msg: "unknown action" })
      });
      return;
    }

    const lambdaClient = new LambdaClient();
    const invokeCommand = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify(payload)
    });

    const lambdaResponse = await lambdaClient.send(invokeCommand);
    const data = JSON.parse(Buffer.from(lambdaResponse.Payload).toString());

    callback(null, {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.log(e);
    callback(null, {
      statusCode: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ status: "err", msg: "invalid request" })
    });
  }
};
