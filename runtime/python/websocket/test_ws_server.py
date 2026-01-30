#!/usr/bin/env python3
import asyncio
import websockets
import json

async def echo(websocket, path):
    """Simple echo server for testing"""
    print(f"New connection from {websocket.remote_address}")
    try:
        async for message in websocket:
            print(f"Received: {message}")
            if isinstance(message, str):
                await websocket.send(json.dumps({"mode": "offline", "text": "Server received: " + message}))
            else:
                await websocket.send(json.dumps({"mode": "offline", "text": "Received binary data"}))
    except websockets.exceptions.ConnectionClosed:
        print("Connection closed")
    except Exception as e:
        print(f"Error: {e}")

async def main():
    print("Starting test WebSocket server on ws://0.0.0.0:10095/")
    server = await websockets.serve(echo, "0.0.0.0", 10095)
    print("Server started!")
    await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
