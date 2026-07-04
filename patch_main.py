with open('backend/main.py', 'r') as f:
    content = f.read()

if 'from backend.test_gemini_endpoint import gemini_bp' not in content:
    content = content.replace(
        "app.register_blueprint(admin_bp)",
        "app.register_blueprint(admin_bp)\nfrom backend.test_gemini_endpoint import gemini_bp\napp.register_blueprint(gemini_bp)"
    )
    with open('backend/main.py', 'w') as f:
        f.write(content)
