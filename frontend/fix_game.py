import json

with open("frontend/game.js", "r") as f:
    content = f.read()

# 1. Update generateQuestion
old_gen_q = """  function generateQuestion(difficulty = "easy") {
    if (difficulty === "hard") {
      const ops = ["*", "/"];
      const op = ops[Math.floor(Math.random() * ops.length)];
      if (op === "*") {
        const a = randInt(6, 12);
        const b = randInt(6, 12);
        return {
          text: `${a} × ${b}`,
          answer: a * b,
          difficulty: "hard",
          mult: 2.0,
        };
      } else {
        const b = randInt(3, 9);
        const answer = randInt(4, 12);
        const a = b * answer;
        return {
          text: `${a} ÷ ${b}`,
          answer: answer,
          difficulty: "hard",
          mult: 2.0,
        };
      }
    } else if (difficulty === "medium") {
      const ops = ["+", "-", "*"];
      const op = ops[Math.floor(Math.random() * ops.length)];
      if (op === "*") {
        const a = randInt(2, 9);
        const b = randInt(2, 5);
        return {
          text: `${a} × ${b}`,
          answer: a * b,
          difficulty: "medium",
          mult: 1.5,
        };
      } else if (op === "+") {
        const a = randInt(10, 25);
        const b = randInt(10, 25);
        return {
          text: `${a} + ${b}`,
          answer: a + b,
          difficulty: "medium",
          mult: 1.5,
        };
      } else {
        const a = randInt(15, 30);
        const b = randInt(5, a - 1);
        return {
          text: `${a} - ${b}`,
          answer: a - b,
          difficulty: "medium",
          mult: 1.5,
        };
      }
    } else {
      const ops = ["+", "-"];
      const op = ops[Math.floor(Math.random() * ops.length)];
      if (op === "+") {
        const a = randInt(1, 10);
        const b = randInt(1, 10);
        return {
          text: `${a} + ${b}`,
          answer: a + b,
          difficulty: "easy",
          mult: 1.0,
        };
      } else {
        const a = randInt(5, 15);
        const b = randInt(1, a - 1);
        return {
          text: `${a} - ${b}`,
          answer: a - b,
          difficulty: "easy",
          mult: 1.0,
        };
      }
    }
  }"""

new_gen_q = """  function generateQuestion(difficulty = "easy") {
    if (difficulty === "hard") {
      const ops = ["*", "/", "combo"];
      const op = ops[Math.floor(Math.random() * ops.length)];
      if (op === "*") {
        const a = randInt(13, 29);
        const b = randInt(13, 29);
        return { text: `${a} × ${b}`, answer: a * b, difficulty: "hard", mult: 2.0 };
      } else if (op === "/") {
        const b = randInt(12, 25);
        const answer = randInt(11, 29);
        const a = b * answer;
        return { text: `${a} ÷ ${b}`, answer: answer, difficulty: "hard", mult: 2.0 };
      } else {
        const a = randInt(50, 150);
        const b = randInt(25, 99);
        const c = randInt(15, 65);
        return { text: `${a} + ${b} - ${c}`, answer: a + b - c, difficulty: "hard", mult: 2.0 };
      }
    } else if (difficulty === "medium") {
      const ops = ["+", "-", "*"];
      const op = ops[Math.floor(Math.random() * ops.length)];
      if (op === "*") {
        const a = randInt(6, 15);
        const b = randInt(6, 15);
        return { text: `${a} × ${b}`, answer: a * b, difficulty: "medium", mult: 1.5 };
      } else if (op === "+") {
        const a = randInt(45, 99);
        const b = randInt(45, 99);
        return { text: `${a} + ${b}`, answer: a + b, difficulty: "medium", mult: 1.5 };
      } else {
        const a = randInt(100, 199);
        const b = randInt(45, 99);
        return { text: `${a} - ${b}`, answer: a - b, difficulty: "medium", mult: 1.5 };
      }
    } else {
      const ops = ["+", "-"];
      const op = ops[Math.floor(Math.random() * ops.length)];
      if (op === "+") {
        const a = randInt(1, 10);
        const b = randInt(1, 10);
        return { text: `${a} + ${b}`, answer: a + b, difficulty: "easy", mult: 1.0 };
      } else {
        const a = randInt(5, 15);
        const b = randInt(1, a - 1);
        return { text: `${a} - ${b}`, answer: a - b, difficulty: "easy", mult: 1.0 };
      }
    }
  }"""

if old_gen_q in content:
    content = content.replace(old_gen_q, new_gen_q)
    print("generateQuestion replaced")
else:
    print("WARNING: generateQuestion not found")


# 2. Add IG button
old_buttons = """            <!-- buttons -->
            <div style="display:flex;gap:10px;">
              <button id="btn-download" style="padding:10px 20px;background:#C9913A;color:#000;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:1px;">DOWNLOAD CARD</button>
              <button id="btn-tweet" style="padding:10px 20px;background:#fff;color:#000;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:1px;">SHARE TO X</button>
              <button id="btn-close" style="padding:10px 20px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:8px;font-size:13px;cursor:pointer;">CLOSE</button>
            </div>"""

new_buttons = """            <!-- buttons -->
            <div style="display:flex;gap:10px;">
              <button id="btn-download" style="padding:10px 20px;background:#C9913A;color:#000;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:1px;">DOWNLOAD CARD</button>
              <button id="btn-tweet" style="padding:10px 20px;background:#fff;color:#000;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:1px;">SHARE TO X</button>
              <button id="btn-ig" style="padding:10px 20px;background:linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:1px;">SHARE TO IG</button>
              <button id="btn-close" style="padding:10px 20px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:8px;font-size:13px;cursor:pointer;">CLOSE</button>
            </div>"""

if old_buttons in content:
    content = content.replace(old_buttons, new_buttons)
    print("IG button added")
else:
    print("WARNING: IG button HTML not found")


# 3. Add IG click handler
old_close = """    document.getElementById("btn-close").onclick = () => card.remove();"""
new_close = """    document.getElementById("btn-ig").onclick = async () => {
      try {
        const canvas = await html2canvas(document.getElementById("victory-card"), { scale: 2 });
        canvas.toBlob(async (blob) => {
          const file = new File([blob], "victory.png", { type: "image/png" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: 'Trading IQ Victory',
              text: 'Just crushed Trading IQ Battle! 🏆'
            });
            document.getElementById("btn-ig").textContent = "SHARED ✓";
          } else {
            const a = document.createElement("a");
            a.download = "trading-iq-victory-ig.png";
            a.href = canvas.toDataURL();
            a.click();
            alert("Downloaded image! You can now post it to Instagram.");
          }
        });
      } catch (err) {
        console.error("Error sharing to IG", err);
      }
    };

    document.getElementById("btn-close").onclick = () => card.remove();"""

if old_close in content:
    content = content.replace(old_close, new_close)
    print("IG handler added")
else:
    print("WARNING: Close button handler not found")

with open("frontend/game.js", "w") as f:
    f.write(content)

