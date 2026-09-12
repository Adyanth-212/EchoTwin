import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from app import config
from app.main import app
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
                "http://100.64.88.63:11434",
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

    @patch.object(config, "TAILSCALE_OLLAMA_URL", "http://ollama.test")
    @patch("app.ollama_client.httpx.post")
    def test_visitor_question_reaches_model_with_room_context(self, post):
        post.return_value.json.return_value = {"response": "Inspect ventilation."}
        advice = get_ai_advice({"sensors": {"eco2": 1200}}, "Why is air quality high?")
        prompt = post.call_args.kwargs["json"]["prompt"]
        self.assertIn("Why is air quality high?", prompt)
        self.assertIn("1200", prompt)
        self.assertEqual(advice, "Inspect ventilation.")

    @patch.object(config, "TAILSCALE_OLLAMA_URL", "http://ollama.test")
    @patch("app.ollama_client.httpx.post")
    def test_empty_model_response_uses_rules(self, post):
        post.return_value.json.return_value = {"response": "  "}
        self.assertIsNone(get_ai_advice({"room_id": "corridor_a"}))


class AdviceRouteTests(unittest.TestCase):
    @patch("app.main.get_ai_advice", return_value="Inspect ventilation.")
    @patch("app.main.fetch_room_status", return_value={"suggestions": []})
    def test_question_is_forwarded_and_legacy_get_still_works(self, fetch_status, advice):
        client = TestClient(app)
        response = client.get("/room-status/corridor_a/ai-advice", params={"question": "Why?"})
        self.assertEqual(response.status_code, 200)
        advice.assert_called_with(fetch_status.return_value, question="Why?")
        self.assertEqual(response.json()["source"], "ollama")
        self.assertEqual(client.get("/room-status/corridor_a/ai-advice").status_code, 200)
        advice.assert_called_with(fetch_status.return_value, question=None)

    @patch("app.main.get_ai_advice", return_value=None)
    @patch("app.main.fetch_room_status", return_value={"suggestions": []})
    def test_offline_model_with_no_alerts_has_visible_rules_answer(self, fetch_status, advice):
        response = TestClient(app).get("/room-status/corridor_a/ai-advice")
        self.assertEqual(response.json()["source"], "rules")
        self.assertTrue(response.json()["advice"])

    @patch("app.main.get_ai_advice")
    def test_oversized_question_is_rejected_before_inference(self, advice):
        response = TestClient(app).get("/room-status/corridor_a/ai-advice", params={"question": "x" * 1001})
        self.assertEqual(response.status_code, 422)
        advice.assert_not_called()


if __name__ == "__main__":
    unittest.main()
