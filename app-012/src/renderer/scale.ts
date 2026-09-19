export class ScaleRenderer {
  x: number = 20;
  y: number = 100;
  w: number = 280;
  h: number = 320;
  pointerAngle: number = 0;
  targetAngle: number = 0;

  layout(canvasW: number, canvasH: number): void {
    this.x = 20;
    this.y = 100;
    this.w = Math.min(280, canvasW * 0.35);
    this.h = Math.min(320, canvasH * 0.5);
  }

  updatePointer(loadGrams: number, zeroOffset: number, fullScale: number): void {
    const ratio = Math.max(0, Math.min(1, (loadGrams - zeroOffset) / fullScale));
    this.targetAngle = -Math.PI * 0.75 + ratio * Math.PI * 1.5;
  }

  animate(): void {
    this.pointerAngle += (this.targetAngle - this.pointerAngle) * 0.15;
  }

  draw(ctx: CanvasRenderingContext2D, currentWeight: number, zeroOffset: number): void {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2 + 30;
    const r = Math.min(this.w, this.h) / 2 - 20;

    ctx.fillStyle = '#f5f0e8';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 4;
    ctx.stroke();

    for (let i = 0; i <= 50; i += 5) {
      const angle = -Math.PI * 0.75 + (i / 50) * Math.PI * 1.5;
      const isMajor = i % 10 === 0;
      const len = isMajor ? 12 : 6;
      const x1 = cx + Math.cos(angle) * (r - len);
      const y1 = cy + Math.sin(angle) * (r - len);
      const x2 = cx + Math.cos(angle) * r;
      const y2 = cy + Math.sin(angle) * r;
      ctx.strokeStyle = '#333';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = '#333';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tx = cx + Math.cos(angle) * (r - 24);
        const ty = cy + Math.sin(angle) * (r - 24);
        ctx.fillText(String(i), tx, ty);
      }
    }

    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 30, -Math.PI * 0.75, Math.PI * 0.75);
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.pointerAngle);
    ctx.fillStyle = '#dc143c';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(r - 35, 0);
    ctx.lineTo(0, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillRect(this.x, this.y, this.w, 40);
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x, this.y, this.w, 40);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${currentWeight.toFixed(1)}g`, cx, this.y + 20);

    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.fillText(`归零: ${zeroOffset.toFixed(1)}g`, cx, this.y + 58);
  }

  drawWeightButton(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, active: boolean): void {
    ctx.fillStyle = active ? '#d4a574' : '#f5e6d3';
    ctx.fillRect(x, y, 40, 32);
    ctx.strokeStyle = '#8b6914';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 40, 32);
    ctx.fillStyle = '#333';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 20, y + 16);
  }
}
