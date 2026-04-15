import json
import time
import boto3
import os
from botocore.exceptions import ClientError
from botocore.client import Config
import uuid
from urllib import parse
import re


def lambda_handler(event, context):
    print(json.dumps(event))
    if "file" in event:
        s3 = boto3.client(
            's3',
            region_name=os.environ["AWS_REGION"],
            endpoint_url=f'https://s3.{os.environ["AWS_REGION"]}.amazonaws.com',
            config=Config(s3={'addressing_style': 'virtual'})
        )
        uuidv4 = str(uuid.uuid4())

        # sanitize user-supplied filename before using it in the object key
        original_name = event["file"]
        safe_name = os.path.basename(original_name)

        if not is_safe(safe_name):
            return json.dumps({"status": "err", "msg": "invalid filename"})

        try:
            response = s3.generate_presigned_post(
                os.environ["FEEDBACK_BUCKET"],
                uuidv4 + "_" + safe_name,
                ExpiresIn=120
            )
            print(response)
        except ClientError as e:
            print(str(e))
            return json.dumps({"status": "err", "msg": "could not get signed url"})

        return response

    elif "Records" in event:
        filename = parse.unquote_plus(event["Records"][0]["s3"]["object"]["key"])
        filename = os.path.basename(filename)

        if not is_safe(filename):
            return {"status": "error", "message": "invalid filename"}

        file1 = f"/tmp/{filename}"
        file2 = f"/tmp/{filename}.txt"

        with open(file1, "a", encoding="utf-8"):
            pass

        with open(file2, "a", encoding="utf-8"):
            pass

        return {"status": "ok", "message": "files created safely"}

    else:
        return {"status": "ok", "message": "Thank you."}


def is_safe(s):
    return re.fullmatch(r"[A-Za-z0-9._/\-]+", s) is not None