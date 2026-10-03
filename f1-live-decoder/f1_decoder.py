import asyncio
import json
import base64
import zlib
import websockets
import requests
import urllib.parse

# Official F1 Live Timing Endpoints
NEGOTIATE_URL = "https://livetiming.formula1.com/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22streaming%22%7D%5D"
HUB_URL = "wss://livetiming.formula1.com/signalr/connect?clientProtocol=1.5&transport=webSockets&connectionToken={}&connectionData=%5B%7B%22name%22%3A%22streaming%22%7D%5D"

connected_clients = set()

async def register_client(websocket):
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)

def decode_f1_zlib(encoded_data):
    try:
        decoded_base64 = base64.b64decode(encoded_data)
        # -zlib.MAX_WBITS tells zlib to process raw deflate streams (bypassing missing headers)
        uncompressed = zlib.decompress(decoded_base64, -zlib.MAX_WBITS)
        return json.loads(uncompressed.decode('utf-8'))
    except Exception as e:
        return None

async def connect_to_f1_pitwall():
    print("🏎️  Negotiating with official F1 Servers...")
    response = requests.get(NEGOTIATE_URL)
    token = response.json()['ConnectionToken']
    ws_url = HUB_URL.format(urllib.parse.quote(token))

    print("📡 Connecting to Live SignalR stream...")
    async with websockets.connect(ws_url, extra_headers={'User-Agent': 'BestHTTP'}) as ws:
        # Subscribe to Telemetry and Timing channels
        subscribe_msg = {
            "H": "streaming",
            "M": "Subscribe",
            "A": [["CarData.z", "Position.z", "TimingData", "RaceControlMessages"]],
            "I": 1
        }
        await ws.send(json.dumps(subscribe_msg))
        print("✅ Connected! Intercepting Live Telemetry...")

        async for msg in ws:
            if not connected_clients:
                continue # Skip processing if Node.js isn't listening

            data = json.loads(msg)
            if 'M' in data:
                for message in data['M']:
                    if message['M'] == 'feed':
                        feed = message['A'][0]
                        output_payload = {}
                        
                        # Intercept and decode Z-lib compressed telemetry
                        if 'CarData.z' in feed:
                            output_payload['telemetry'] = decode_f1_zlib(feed['CarData.z'])
                        if 'RaceControlMessages' in feed:
                            output_payload['race_control'] = feed['RaceControlMessages']

                        if output_payload:
                            websockets.broadcast(connected_clients, json.dumps(output_payload))

async def main():
    async with websockets.serve(register_client, "localhost", 8082):
        print("🚀 Python F1 Decoder running on ws://localhost:8082")
        await connect_to_f1_pitwall()

if __name__ == "__main__":
    asyncio.run(main())