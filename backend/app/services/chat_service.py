from typing import AsyncGenerator, Optional
from ..agents.assistant import get_agent


async def stream_chat(
    message: str,
    conversation_context: str = "",
    model_override: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Streams response chunks from the NexusAI assistant agent."""
    prompt = message

    if conversation_context:
        prompt = f"""Here is the previous conversation:

{conversation_context}

Now answer the user's latest message:
{message}
"""

    agent_instance = get_agent(model_override)

    async with agent_instance.run_stream(prompt) as result:
        async for chunk in result.stream_text(delta=True):
            yield chunk