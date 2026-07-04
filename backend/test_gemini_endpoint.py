from flask import Blueprint, jsonify
from backend.openrouter_client import call_gemini_fallback
from backend.schemas import NewsAnalysis

gemini_bp = Blueprint('gemini_test', __name__)

@gemini_bp.route('/api/admin/test-gemini', methods=['GET'])
def test_gemini():
    try:
        res = call_gemini_fallback("You are an analyst.", "Analyze: AAPL goes up.", NewsAnalysis)
        return jsonify({"result": res})
    except Exception as e:
        return jsonify({"error": str(e)})
