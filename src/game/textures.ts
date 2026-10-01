import * as THREE from "three";

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat: [number, number]) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function woodFloor() {
  return canvasTex(512, 512, (c) => {
    const tones = ["#8a5a33", "#9b6a3e", "#7d4f2c", "#a8764a", "#916238"];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 2; j++) {
        const off = i % 2 ? 128 : 0;
        c.fillStyle = tones[(i * 3 + j) % tones.length]!;
        c.fillRect(i * 64, j * 256 + off - 256, 64, 256);
        c.fillRect(i * 64, j * 256 + off, 64, 256);
      }
      for (let k = 0; k < 40; k++) {
        c.strokeStyle = `rgba(40,20,5,${Math.random() * 0.15})`;
        c.beginPath();
        const x = i * 64 + Math.random() * 64;
        c.moveTo(x, 0);
        c.bezierCurveTo(x + 4, 170, x - 4, 340, x, 512);
        c.stroke();
      }
      c.fillStyle = "rgba(30,15,5,0.6)";
      c.fillRect(i * 64, 0, 2, 512);
    }
  }, [8, 6]);
}

export function wallpaper() {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = "#d9c7a3";
    c.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      c.fillStyle = x % 64 ? "#cfb98f" : "#e3d3b2";
      c.fillRect(x, 0, 16, 256);
    }
    c.fillStyle = "#b49a6c";
    for (let y = 16; y < 256; y += 64) for (let x = 24; x < 256; x += 64) {
      c.beginPath();
      c.arc(x, y, 5, 0, Math.PI * 2);
      c.fill();
    }
  }, [12, 3]);
}

export function rug() {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = "#7a2632";
    c.fillRect(0, 0, 512, 512);
    c.strokeStyle = "#d8b56a";
    c.lineWidth = 14;
    c.strokeRect(30, 30, 452, 452);
    c.lineWidth = 5;
    c.strokeRect(60, 60, 392, 392);
    c.fillStyle = "#1f3b4d";
    c.beginPath();
    c.moveTo(256, 110); c.lineTo(400, 256); c.lineTo(256, 402); c.lineTo(112, 256);
    c.fill();
    c.fillStyle = "#d8b56a";
    c.beginPath();
    c.arc(256, 256, 40, 0, Math.PI * 2);
    c.fill();
  }, [1, 1]);
}

export function tableWood() {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = "#b07a45";
    c.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 60; k++) {
      c.strokeStyle = `rgba(70,35,10,${Math.random() * 0.25})`;
      c.lineWidth = Math.random() * 2;
      const y = Math.random() * 256;
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(80, y + 8, 170, y - 8, 256, y);
      c.stroke();
    }
  }, [1, 1]);
}
