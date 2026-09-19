import type { HerbMeta } from '../types';

export interface DrawerRect {
  x: number;
  y: number;
  w: number;
  h: number;
  herb: string;
  open: number;
  hovered: boolean;
}

export class CabinetRenderer {
  drawers: DrawerRect[] = [];
  private cols = 6;
  private rows = 6;
  private padding = 10;
  private drawerW = 80;
  private drawerH = 50;

  layout(canvasW: number, _canvasH: number): void {
    this.drawers = [];
    const startX = canvasW - this.cols * (this.drawerW + this.padding) - this.padding;
    const startY = this.padding + 60;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.drawers.push({
          x: startX + c * (this.drawerW + this.padding),
          y: startY + r * (this.drawerH + this.padding),
          w: this.drawerW,
          h: this.drawerH,
          herb: '',
          open: 0,
          hovered: false,
        });
      }
    }
  }

  setHerbs(herbs: HerbMeta[]): void {
    for (let i = 0; i < this.drawers.length && i < herbs.length; i++) {
      this.drawers[i].herb = herbs[i].name;
    }
    for (let i = herbs.length; i < this.drawers.length; i++) {
      this.drawers[i].herb = '';
    }
  }

  updateHover(mx: number, my: number): void {
    for (const d of this.drawers) {
      d.hovered = mx >= d.x && mx <= d.x + d.w && my >= d.y && my <= d.y + d.h;
    }
  }

  getDrawerAt(mx: number, my: number): DrawerRect | null {
    return this.drawers.find(d => mx >= d.x && mx <= d.x + d.w && my >= d.y && my <= d.y + d.h) || null;
  }

  openDrawer(herb: string): void {
    const d = this.drawers.find(x => x.herb === herb);
    if (d) d.open = 1;
  }

  closeDrawer(herb: string): void {
    const d = this.drawers.find(x => x.herb === herb);
    if (d) d.open = 0;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const d of this.drawers) {
      this.drawDrawer(ctx, d);
    }
  }

  private drawDrawer(ctx: CanvasRenderingContext2D, d: DrawerRect): void {
    const depth = d.open * 8;
    const bg = d.hovered ? '#8b6914' : '#6b4e23';

    ctx.fillStyle = '#4a3728';
    ctx.fillRect(d.x, d.y, d.w, d.h);

    ctx.fillStyle = bg;
    ctx.fillRect(d.x + depth, d.y + depth, d.w - depth * 2, d.h - depth * 2);

    ctx.strokeStyle = '#3e2b1f';
    ctx.lineWidth = 2;
    ctx.strokeRect(d.x + depth, d.y + depth, d.w - depth * 2, d.h - depth * 2);

    if (d.herb) {
      ctx.fillStyle = '#f5e6d3';
      ctx.font = '14px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.herb, d.x + d.w / 2 + depth, d.y + d.h / 2 + depth);
    }

    if (d.open > 0.5) {
      ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
      ctx.fillRect(d.x + depth + 4, d.y + depth + 4, d.w - depth * 2 - 8, d.h - depth * 2 - 8);
    }
  }
}
