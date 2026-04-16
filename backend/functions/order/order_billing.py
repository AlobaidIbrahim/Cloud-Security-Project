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

# in the fix part
REQUEST_LIMIT_SECONDS = 2


def release_lock(table, key):
    try:
        table.update_item(
            Key=key,
            UpdateExpression="REMOVE workflowLock, workflowLockTS, lastRequestTime",
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

    response = table.get_item(Key=key)
    if "Item" not in response:
        return {"status": "err", "msg": "could not find order"}

    item = response["Item"]

    #fIX the rate limiting check
    last_request = item.get("lastRequestTime", 0)
    if now_ts - last_request < REQUEST_LIMIT_SECONDS:
        return {"status": "err", "msg": "Too many requests"}

    status = int(json.dumps(item["orderStatus"], cls=DecimalEncoder))
    if status >= 120:
        return {"status": "err", "msg": "order already made"}

    try:
        table.update_item(
            Key=key,
            UpdateExpression="SET workflowLock = :lock_name, workflowLockTS = :lock_ts, lastRequestTime = :req_ts",
            ConditionExpression=(
                "orderStatus < :paid_status AND "
                "(attribute_not_exists(workflowLock) OR "
                "(workflowLock = :lock_name AND workflowLockTS < :stale_before))"
            ),
            ExpressionAttributeValues={
                ":lock_name": LOCK_NAME,
                ":lock_ts": now_ts,
                ":req_ts": now_ts,
                ":stale_before": now_ts - LOCK_TIMEOUT_SECONDS,
                ":paid_status": 120,
            },
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return {"status": "err", "msg": "order is being processed, try again"}
        return {"status": "err", "msg": "could not lock order for billing"}

    try:
        data_dict = []
        for item_id, quantity in item["itemList"].items():
            data_dict.append({"itemId": item_id, "quantity": int(quantity)})
        data = json.dumps(data_dict, cls=DecimalEncoder)

        total_url = os.environ["GET_CART_TOTAL"]
        req = http.request("POST", total_url, body=data, headers={"Content-Type": "application/json"})
        total_res = json.loads(req.data)
        cart_total = float(total_res["total"])

        billing_data = json.dumps(event["billing"])
        pay_url = os.environ["PAYMENT_PROCESS_URL"]
        req = http.request("POST", pay_url, body=billing_data, headers={"Content-Type": "application/json"})
        pay_res = json.loads(req.data)

        if pay_res["status"] != 120:
            release_lock(table, key)
            return {"status": "err", "msg": "payment failed"}

        table.update_item(
            Key=key,
            UpdateExpression="SET orderStatus = :orderstatus REMOVE workflowLock, workflowLockTS",
            ExpressionAttributeValues={
                ":orderstatus": pay_res["status"],
            },
        )

        return {"status": "ok", "amount": float(cart_total)}

    except Exception:
        release_lock(table, key)
        return {"status": "err", "msg": "unknown error"}