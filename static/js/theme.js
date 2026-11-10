// Dimuat sinkron di <head> agar tema tersimpan langsung diterapkan tanpa kedipan.
try {
  const theme = localStorage.getItem('theme');
  if (theme) document.documentElement.dataset.theme = theme;
} catch { /* penyimpanan tidak tersedia */ }
