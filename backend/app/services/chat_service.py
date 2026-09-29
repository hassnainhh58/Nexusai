from ..agents.assistant import agent


async def stream_chat(
    message: str,
    conversation_context: str = "",
):
    prompt = message

    if conversation_context:
        prompt = f"""
Here is the previous conversation:

{conversation_context}

Now answer the user's latest message:

{message}
"""

    async with agent.run_stream(prompt) as result:
        async for chunk in result.stream_text(delta=True):
            yield chunk