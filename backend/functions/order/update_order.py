import boto3
import os
from botocore.exceptions import ClientError

# status list
# -----------
# 100: open
# 110: payment-failed
# 120: paid
# 200: processing
# 210: shipped
# 300: delivered
# 500: cancelled
# 600: rejected


def lambda_handler(event, context):
    order_id = event["orderId"]
    item_list = event["items"]
    user_id = event["user"]

    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(os.environ["ORDERS_TABLE"])

    try:
        response = table.update_item(
            Key={"orderId": order_id, "userId": user_id},
            UpdateExpression="SET itemList = :itemList",
            ConditionExpression=(
                "attribute_exists(orderId) AND "
                "orderStatus <= :max_editable_status AND "
                "attribute_not_exists(workflowLock)"
            ),
            ExpressionAttributeValues={
                ":itemList": item_list,
                ":max_editable_status": 110,
            },
            ReturnValues="UPDATED_NEW",
        )
        if response["ResponseMetadata"]["HTTPStatusCode"] == 200:
            return {"status": "ok", "msg": "cart updated"}
        return {"status": "err", "msg": "could not update cart"}

    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return {
                "status": "err",
                "msg": "order cannot be updated after billing starts or while it is being processed",
            }
        return {"status": "err", "msg": "could not update cart"}
