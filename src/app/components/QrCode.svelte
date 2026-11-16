<script lang="ts">
  import qrcode from 'qrcode-generator';

  interface Props {
    text: string;
    label?: string;
  }
  let { text, label = 'QR code' }: Props = $props();

  /** One SVG path of dark squares, drawn here so it stays crisp at any print size. */
  const qr = $derived.by(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { size: n + 8, d }; // 4 modules of quiet zone around it, as scanners expect
  });
</script>

<!-- Always black on white: phone cameras can't read a light-on-dark code reliably. -->
<svg class="qr" viewBox="0 0 {qr.size} {qr.size}" role="img" aria-label={label} shape-rendering="crispEdges">
  <rect width={qr.size} height={qr.size} fill="#fff" />
  <path d={qr.d} fill="#000" />
</svg>

<style>
  .qr { display: block; width: 100%; height: auto; }
</style>
