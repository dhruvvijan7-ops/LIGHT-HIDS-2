import asyncio
import uvicorn
from uvicorn.main import Server
from apps.api.sentinel_api.app import create_app
from sentinel_core.config import load_settings

settings = load_settings()
app = create_app(settings)

async def run():
    config = uvicorn.Config(app, host=settings.server_host, port=settings.server_port, log_level='info')
    server = Server(config)
    await server.serve()

if __name__ == "__main__":
    asyncio.run(run())