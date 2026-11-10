/**
 * Virtual list berbasis scroll jendela: hanya baris yang terlihat yang dirender,
 * sehingga ribuan ulasan tetap ringan. Tinggi baris diambil dari CSS var --row-h.
 */
export class VirtualList {
  constructor(container, renderRow, overscan = 6) {
    this.container = container;
    this.renderRow = renderRow;
    this.overscan = overscan;
    this.items = [];
    this.rowH = 0;
    this.rows = new Map(); // index -> node
    this.inner = document.createElement('div');
    this.inner.className = 'vlist-inner';
    container.append(this.inner);

    const schedule = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.update();
      });
    };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', () => {
      this.rowH = 0;
      this.clear();
      schedule();
    }, { passive: true });
  }

  setItems(items) {
    this.items = items;
    this.update();
  }

  clear() {
    for (const node of this.rows.values()) node.remove();
    this.rows.clear();
  }

  update() {
    if (!this.rowH) {
      this.rowH = parseFloat(getComputedStyle(this.container).getPropertyValue('--row-h')) || 132;
    }
    const { items, rowH } = this;
    this.inner.style.height = `${items.length * rowH}px`;

    const top = this.container.getBoundingClientRect().top;
    const start = Math.max(0, Math.floor(-top / rowH) - this.overscan);
    const end = Math.min(items.length, Math.ceil((innerHeight - top) / rowH) + this.overscan);

    for (const [i, node] of this.rows) {
      if (i < start || i >= end || node.itemKey !== items[i]?.id) {
        node.remove();
        this.rows.delete(i);
      }
    }
    for (let i = start; i < end; i++) {
      let node = this.rows.get(i);
      if (!node) {
        node = this.renderRow(items[i], i);
        node.itemKey = items[i].id;
        node.style.transform = `translateY(${i * rowH}px)`;
        this.inner.append(node);
        this.rows.set(i, node);
      }
      node.setAttribute('aria-setsize', items.length);
      node.setAttribute('aria-posinset', i + 1);
    }
  }
}
