import unittest
from unittest.mock import Mock, patch

from app import config
from app.ollama_client import get_ai_advice


class OllamaClientTests(unittest.TestCase):
    @patch("app.ollama_client.httpx.post")
    def test_qwen_request_disables_thinking(self, post):
        response = Mock()
        response.json.return_value = {"response": "Open the windows."}
        post.return_value = response

        with (
            patch.object(
                config,
                "TAILSCALE_OLLAMA_URL",
                "http://192.0.2.40:11434",
            ),
            patch.object(config, "OLLAMA_MODEL", "qwen3:8b"),
            patch.object(config, "OLLAMA_TIMEOUT_SECONDS", 20.0),
        ):
            advice = get_ai_advice({"room_id": "test_room"})

        self.assertEqual(advice, "Open the windows.")
        response.raise_for_status.assert_called_once_with()
        post.assert_called_once()
        _, kwargs = post.call_args
        self.assertEqual(
            kwargs["json"],
            {
                "model": "qwen3:8b",
                "prompt": kwargs["json"]["prompt"],
                "stream": False,
                "think": False,
            },
        )
        self.assertEqual(kwargs["timeout"], 20.0)


if __name__ == "__main__":
    unittest.main()
