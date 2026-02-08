#!/usr/bin/env python3
"""
Twitter/X API helper using OAuth 1.0a
Usage:
  python3 twitter-api.py mentions [count]           # Get recent mentions
  python3 twitter-api.py timeline [count]            # Home timeline
  python3 twitter-api.py search "query" [count]      # Search tweets
  python3 twitter-api.py get <tweet_id>              # Get single tweet
  python3 twitter-api.py my-tweets [count]           # Our recent tweets + metrics
  python3 twitter-api.py tweet "Hello world"
  python3 twitter-api.py tweet-media "Hello world" /path/to/image.png
  python3 twitter-api.py reply <tweet_id> "Reply text"
  python3 twitter-api.py reply-media <tweet_id> "text" /path/to/image.png
  python3 twitter-api.py like <tweet_id>
  python3 twitter-api.py retweet <tweet_id>
  python3 twitter-api.py delete <tweet_id>
  python3 twitter-api.py bio "New bio text"
  python3 twitter-api.py dm <user_id> "Message text"
  python3 twitter-api.py dm-conv <conversation_id> "Message text"
"""

import sys, time, hashlib, hmac, urllib.parse, secrets, base64, http.client, json

# Credentials
AK = "qx7UevJ9Ik8VcGTU9wHlgynna"
AKS = "Sr6poxYJESoYctndEufjjtjXgXUGz1urinA8K8ADw0yLtcoDt6"
AT = "2013700835654672388-HUnMlIBkv1KiSKSSjFU3m68gffRHl1"
ATS = "pYBAUzVjP4wWesaymDq4EQ3ddlcHqq7LRGoXTeZHJOJVP"

def oauth_sign(method, url, extra_params=None):
    ts = str(int(time.time()))
    nonce = secrets.token_hex(16)
    oauth = {
        "oauth_consumer_key": AK, "oauth_nonce": nonce,
        "oauth_signature_method": "HMAC-SHA1", "oauth_timestamp": ts,
        "oauth_token": AT, "oauth_version": "1.0"
    }
    all_p = {**oauth, **(extra_params or {})}
    ps = "&".join(f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(str(v), safe='')}" for k, v in sorted(all_p.items()))
    bs = f"{method}&{urllib.parse.quote(url, safe='')}&{urllib.parse.quote(ps, safe='')}"
    sk = f"{urllib.parse.quote(AKS, safe='')}&{urllib.parse.quote(ATS, safe='')}"
    sig = base64.b64encode(hmac.new(sk.encode(), bs.encode(), hashlib.sha1).digest()).decode()
    oauth["oauth_signature"] = sig
    return "OAuth " + ", ".join(f'{k}="{urllib.parse.quote(v, safe="")}"' for k, v in oauth.items())

def api_call(method, path, body=None, content_type="application/json", host="api.twitter.com", form_params=None):
    # For GET requests with query params, include them in OAuth signature
    base_path = path.split("?")[0]
    query_params = {}
    if "?" in path:
        query_params = dict(urllib.parse.parse_qsl(path.split("?", 1)[1]))
    sign_params = form_params or query_params if method == "GET" else form_params
    auth = oauth_sign(method, f"https://{host}{base_path}", sign_params)
    conn = http.client.HTTPSConnection(host)
    headers = {"Authorization": auth, "Content-Type": content_type}
    b = json.dumps(body) if body and content_type == "application/json" else body
    conn.request(method, path, body=b, headers=headers)
    r = conn.getresponse()
    data = json.loads(r.read().decode())
    return r.status, data

def tweet(text, reply_to=None):
    body = {"text": text}
    if reply_to:
        body["reply"] = {"in_reply_to_tweet_id": reply_to}
    status, data = api_call("POST", "/2/tweets", body)
    if "data" in data:
        tid = data["data"]["id"]
        print(f"✅ https://x.com/AxiomBot/status/{tid}")
    else:
        print(f"❌ {data}")

def like(tweet_id):
    status, data = api_call("POST", f"/2/users/2013700835654672388/likes", {"tweet_id": tweet_id})
    print("✅ Liked" if data.get("data", {}).get("liked") else f"❌ {data}")

def retweet(tweet_id):
    status, data = api_call("POST", f"/2/users/2013700835654672388/retweets", {"tweet_id": tweet_id})
    print("✅ Retweeted" if data.get("data", {}).get("retweeted") else f"❌ {data}")

def delete(tweet_id):
    status, data = api_call("DELETE", f"/2/tweets/{tweet_id}")
    print("✅ Deleted" if data.get("data", {}).get("deleted") else f"❌ {data}")

def bio(text):
    form = urllib.parse.urlencode({"description": text}, quote_via=urllib.parse.quote)
    auth = oauth_sign("POST", "https://api.twitter.com/1.1/account/update_profile.json", {"description": text})
    conn = http.client.HTTPSConnection("api.twitter.com")
    conn.request("POST", "/1.1/account/update_profile.json", body=form, headers={
        "Authorization": auth, "Content-Type": "application/x-www-form-urlencoded"
    })
    r = conn.getresponse()
    data = json.loads(r.read().decode())
    print(f"✅ Bio: {data.get('description', data)}")

def dm(recipient_id, text):
    """Send a DM using Twitter API v2"""
    # v2 DM endpoint
    body = {
        "text": text,
        "participant_ids": [recipient_id]
    }
    status, data = api_call("POST", "/2/dm_conversations", body)
    if status == 201 or "data" in data:
        print(f"✅ DM sent to {recipient_id}")
        if "data" in data:
            print(f"   Conversation: {data['data'].get('dm_conversation_id', 'unknown')}")
    elif status == 403:
        print(f"❌ DM failed (403): No permission. Need elevated API access or user doesn't allow DMs.")
        print(f"   Details: {data}")
    else:
        print(f"❌ DM failed ({status}): {data}")

def dm_to_conversation(conversation_id, text):
    """Send a DM to existing conversation"""
    body = {"text": text}
    status, data = api_call("POST", f"/2/dm_conversations/{conversation_id}/messages", body)
    if status == 201 or "data" in data:
        print(f"✅ DM sent to conversation {conversation_id}")
    else:
        print(f"❌ DM failed ({status}): {data}")

def upload_media(file_path):
    """Upload media to Twitter and return media_id"""
    import mimetypes
    
    # Read file
    with open(file_path, 'rb') as f:
        media_data = f.read()
    
    # Get mime type
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type is None:
        mime_type = 'image/png'
    
    # Base64 encode
    media_b64 = base64.b64encode(media_data).decode()
    
    # Upload using v1.1 media upload (chunked for large files, simple for small)
    form_params = {"media_data": media_b64}
    form_body = urllib.parse.urlencode(form_params)
    
    auth = oauth_sign("POST", "https://upload.twitter.com/1.1/media/upload.json", form_params)
    conn = http.client.HTTPSConnection("upload.twitter.com")
    conn.request("POST", "/1.1/media/upload.json", body=form_body, headers={
        "Authorization": auth, "Content-Type": "application/x-www-form-urlencoded"
    })
    r = conn.getresponse()
    data = json.loads(r.read().decode())
    
    if "media_id_string" in data:
        return data["media_id_string"]
    else:
        print(f"❌ Media upload failed: {data}")
        return None

def tweet_with_media(text, media_path, reply_to=None):
    """Post a tweet with an image"""
    media_id = upload_media(media_path)
    if not media_id:
        return
    
    body = {
        "text": text,
        "media": {"media_ids": [media_id]}
    }
    if reply_to:
        body["reply"] = {"in_reply_to_tweet_id": reply_to}
    
    status, data = api_call("POST", "/2/tweets", body)
    if "data" in data:
        tid = data["data"]["id"]
        print(f"✅ https://x.com/AxiomBot/status/{tid}")
    else:
        print(f"❌ {data}")

def mentions(count=15):
    """Get recent mentions of @AxiomBot"""
    params = {"max_results": min(count, 100), "tweet.fields": "created_at,author_id,conversation_id,in_reply_to_user_id,text", "expansions": "author_id", "user.fields": "username"}
    qs = urllib.parse.urlencode(params)
    status, data = api_call("GET", f"/2/users/2013700835654672388/mentions?{qs}")
    if "data" in data:
        users = {u["id"]: u["username"] for u in data.get("includes", {}).get("users", [])}
        for t in data["data"]:
            author = users.get(t.get("author_id"), t.get("author_id", "?"))
            print(f"@{author} [{t['id']}] {t.get('created_at', '')}")
            print(f"  {t['text']}")
            print(f"  https://x.com/{author}/status/{t['id']}")
            print()
    else:
        print(f"❌ {data}")

def timeline(count=20):
    """Get reverse-chronological home timeline"""
    params = {"max_results": min(count, 100), "tweet.fields": "created_at,author_id,text", "expansions": "author_id", "user.fields": "username"}
    qs = urllib.parse.urlencode(params)
    status, data = api_call("GET", f"/2/users/2013700835654672388/timelines/reverse_chronological?{qs}")
    if "data" in data:
        users = {u["id"]: u["username"] for u in data.get("includes", {}).get("users", [])}
        for t in data["data"]:
            author = users.get(t.get("author_id"), t.get("author_id", "?"))
            print(f"@{author} [{t['id']}] {t.get('created_at', '')}")
            print(f"  {t['text'][:200]}")
            print(f"  https://x.com/{author}/status/{t['id']}")
            print()
    else:
        print(f"❌ {data}")

def search(query, count=10):
    """Search recent tweets"""
    params = {"query": query, "max_results": max(min(count, 100), 10), "tweet.fields": "created_at,author_id,text", "expansions": "author_id", "user.fields": "username"}
    qs = urllib.parse.urlencode(params)
    status, data = api_call("GET", f"/2/tweets/search/recent?{qs}")
    if "data" in data:
        users = {u["id"]: u["username"] for u in data.get("includes", {}).get("users", [])}
        for t in data["data"]:
            author = users.get(t.get("author_id"), t.get("author_id", "?"))
            print(f"@{author} [{t['id']}] {t.get('created_at', '')}")
            print(f"  {t['text'][:200]}")
            print(f"  https://x.com/{author}/status/{t['id']}")
            print()
    else:
        print(f"❌ {data}")

def get_tweet(tweet_id):
    """Get a single tweet by ID"""
    params = {"tweet.fields": "created_at,author_id,text,conversation_id,in_reply_to_user_id", "expansions": "author_id", "user.fields": "username"}
    qs = urllib.parse.urlencode(params)
    status, data = api_call("GET", f"/2/tweets/{tweet_id}?{qs}")
    if "data" in data:
        t = data["data"]
        users = {u["id"]: u["username"] for u in data.get("includes", {}).get("users", [])}
        author = users.get(t.get("author_id"), t.get("author_id", "?"))
        print(f"@{author} [{t['id']}] {t.get('created_at', '')}")
        print(f"  {t['text']}")
        print(f"  https://x.com/{author}/status/{t['id']}")
    else:
        print(f"❌ {data}")

def my_tweets(count=10):
    """Get our own recent tweets"""
    params = {"max_results": min(count, 100), "tweet.fields": "created_at,text,public_metrics"}
    qs = urllib.parse.urlencode(params)
    status, data = api_call("GET", f"/2/users/2013700835654672388/tweets?{qs}")
    if "data" in data:
        for t in data["data"]:
            m = t.get("public_metrics", {})
            print(f"[{t['id']}] {t.get('created_at', '')}")
            print(f"  {t['text'][:200]}")
            print(f"  ❤️{m.get('like_count',0)} 🔁{m.get('retweet_count',0)} 💬{m.get('reply_count',0)} 👁{m.get('impression_count',0)}")
            print(f"  https://x.com/AxiomBot/status/{t['id']}")
            print()
    else:
        print(f"❌ {data}")

def reply_with_media(reply_to_id, text, media_path):
    """Reply to a tweet with an image"""
    media_id = upload_media(media_path)
    if not media_id:
        return
    
    body = {
        "text": text,
        "media": {"media_ids": [media_id]},
        "reply": {"in_reply_to_tweet_id": reply_to_id}
    }
    
    status, data = api_call("POST", "/2/tweets", body)
    if "data" in data:
        tid = data["data"]["id"]
        print(f"✅ https://x.com/AxiomBot/status/{tid}")
    else:
        print(f"❌ {data}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    cmd = sys.argv[1]
    if cmd == "mentions":
        mentions(int(sys.argv[2]) if len(sys.argv) > 2 else 15)
    elif cmd == "timeline":
        timeline(int(sys.argv[2]) if len(sys.argv) > 2 else 20)
    elif cmd == "search":
        search(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 10)
    elif cmd == "get":
        get_tweet(sys.argv[2])
    elif cmd == "my-tweets":
        my_tweets(int(sys.argv[2]) if len(sys.argv) > 2 else 10)
    elif cmd == "tweet":
        tweet(sys.argv[2])
    elif cmd == "tweet-media":
        tweet_with_media(sys.argv[2], sys.argv[3])
    elif cmd == "reply":
        tweet(sys.argv[3], reply_to=sys.argv[2])
    elif cmd == "reply-media":
        reply_with_media(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "like":
        like(sys.argv[2])
    elif cmd == "retweet":
        retweet(sys.argv[2])
    elif cmd == "delete":
        delete(sys.argv[2])
    elif cmd == "bio":
        bio(sys.argv[2])
    elif cmd == "dm":
        dm(sys.argv[2], sys.argv[3])
    elif cmd == "dm-conv":
        dm_to_conversation(sys.argv[2], sys.argv[3])
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
