import json
import urllib3
import boto3
import os
import time
import decimal
from decimal import Decimal
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

LOCK_NAME = "billing"
LOCK_TIMEOUT_SECONDS = 120


def release_lock(table, key):
    try:
        table.update_item(
            Key=key,
            UpdateExpression="REMOVE workflowLock, workflowLockTS",
            ConditionExpression="attribute_exists(workflowLock)",
        )
    except ClientError:
        pass


def lambda_handler(event, context):
    print(json.dumps(event))

    class DecimalEncoder(json.JSONEncoder):
        def default(self, o):
            if isinstance(o, decimal.Decimal):
                if o % 1 > 0:
                    return float(o)
                return int(o)
            return super(DecimalEncoder, self).default(o)

    order_id = event["orderId"]
    user_id = event["user"]
    now_ts = int(time.time())

    http = urllib3.PoolManager()
    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(os.environ["ORDERS_TABLE"])
    key = {"orderId": order_id, "userId": user_id}

    response = table.get_item(
        Key=key,
        AttributesToGet=["orderId", "orderStatus", "itemList", "workflowLock", "workflowLockTS"],
    )
    if "Item" not in response:
        return {"status": "err", "msg": "could not find order"}

    item = response["Item"]
    status = int(json.dumps(item["orderStatus"], cls=DecimalEncoder))
    if status >= 120:
        return {"status": "err", "msg": "order already made"}

    try:
        table.update_item(
            Key=key,
            UpdateExpression="SET workflowLock = :lock_name, workflowLockTS = :lock_ts",
            ConditionExpression=(
                "orderStatus < :paid_status AND "
                "(attribute_not_exists(workflowLock) OR "
                "(workflowLock = :lock_name AND workflowLockTS < :stale_before))"
            ),
            ExpressionAttributeValues={
                ":lock_name": LOCK_NAME,
                ":lock_ts": now_ts,
                ":stale_before": now_ts - LOCK_TIMEOUT_SECONDS,
                ":paid_status": 120,
            },
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return {"status": "err", "msg": "order is being processed, try again"}
        return {"status": "err", "msg": "could not lock order for billing"}

    try:
        response = table.get_item(
            Key=key,
            AttributesToGet=["orderId", "orderStatus", "itemList", "workflowLock", "workflowLockTS"],
            ConsistentRead=True,
        )
        if "Item" not in response:
            release_lock(table, key)
            return {"status": "err", "msg": "could not find order"}

        item = response["Item"]
        status = int(json.dumps(item["orderStatus"], cls=DecimalEncoder))
        if status >= 120:
            release_lock(table, key)
            return {"status": "err", "msg": "order already made"}

        data_dict = []
        for item_id, quantity in item["itemList"].items():
            data_dict.append({"itemId": item_id, "quantity": int(quantity)})
        data = json.dumps(data_dict, cls=DecimalEncoder)

        total_url = os.environ["GET_CART_TOTAL"]
        req = http.request(
            "POST",
            total_url,
            body=data,
            headers={"Content-Type": "application/json", "Content-Length": str(len(data))},
        )
        total_res = json.loads(req.data)
        cart_total = float(total_res["total"])
        missings = total_res.get("missing", {})

        billing_data = json.dumps(event["billing"])
        pay_url = os.environ["PAYMENT_PROCESS_URL"]
        req = http.request(
            "POST",
            pay_url,
            body=billing_data,
            headers={"Content-Type": "application/json", "Content-Length": str(len(billing_data))},
        )
        pay_res = json.loads(req.data)

        if pay_res["status"] == 110:
            release_lock(table, key)
            return {"status": "err", "msg": "invalid payment details"}

        if pay_res["status"] != 120:
            release_lock(table, key)
            return {"status": "err", "msg": "could not process payment"}

        update_expression = (
            "SET orderStatus = :orderstatus, paymentTS = :paymentTS, "
            "totalAmount = :total, confirmationToken = :token"
        )
        two_places = Decimal(10) ** -2
        expression_attributes = {
            ":orderstatus": pay_res["status"],
            ":paymentTS": now_ts,
            ":total": Decimal(cart_total).quantize(two_places),
            ":token": pay_res["confirmation_token"],
            ":lock_name": LOCK_NAME,
            ":paid_status": 120,
        }

        if missings:
            new_item_list = {}
            items = item.get("itemList", {})
            for item_id in items:
                new_item_list[item_id] = items[item_id] - missings[item_id] if missings.get(item_id) else items[item_id]
            expression_attributes[":il"] = new_item_list
            update_expression += ", itemList = :il"

        update_expression += " REMOVE workflowLock, workflowLockTS"

        table.update_item(
            Key=key,
            UpdateExpression=update_expression,
            ConditionExpression="workflowLock = :lock_name AND orderStatus < :paid_status",
            ExpressionAttributeValues=expression_attributes,
        )

        sqs = boto3.client("sqs")
        sqs.send_message(
            QueueUrl=os.environ["SQS_URL"],
            MessageBody=json.dumps({"orderId": order_id, "userId": user_id}),
            DelaySeconds=10,
        )

        return {
            "status": "ok",
            "amount": float(cart_total),
            "token": pay_res["confirmation_token"],
            "missing": missings,
        }

    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return {"status": "err", "msg": "order changed during billing"}
        release_lock(table, key)
        return {"status": "err", "msg": "unknown error"}
    except Exception:
        release_lock(table, key)
        return {"status": "err", "msg": "unknown error"}
