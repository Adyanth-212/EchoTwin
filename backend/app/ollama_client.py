import httpx

from app import config


def get_ai_advice(status, question=None):
    if not config.TAILSCALE_OLLAMA_URL:
        return None

    prompt = (
        "You are an assistant for the EchoTwin smart-building system.\n"
        + "Use only the following live room data:\n"
        + str(status)
        + "\nGive one concise, practical recommendation for facility staff. "
        + "Do not diagnose a failure with certainty or invent readings. "
        + "Maximum two sentences."
    )
    if question:
        prompt += (
            "\nVisitor question: " + question.strip()
            + "\nAnswer this question using the room data above. If it cannot "
            + "be answered from that data, say what information is missing."
        )

    try:
        response = httpx.post(
            config.TAILSCALE_OLLAMA_URL.rstrip("/") + "/api/generate",
            json={
                "model": config.OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "think": False,
            },
            timeout=config.OLLAMA_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        advice = response.json()["response"].strip()
        return advice or None
    except Exception as error:
        print("Ollama unavailable; using rule-based advice:", error)
        return None
