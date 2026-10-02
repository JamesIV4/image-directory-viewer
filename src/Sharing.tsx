import { useEffect, useRef, useState } from 'react';
export default function Sharing() {
  const [visible, setVisible] = useState(false), [state, setState] = useState<{ active: boolean; token: string; addresses: string[] }>({ active: false, token: '', addresses: [] });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (visible) dialog.current?.showModal(); }, [visible]);
  const change = async (active: boolean) => {
    setBusy(true); setError('');
    try { setState(await window.lumen.setSharing(active)); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <><button onClick={() => { void window.lumen.sharingState().then(setState); setVisible(true); }}>Share on network</button>
    {visible && <dialog ref={dialog} onCancel={() => setVisible(false)} className="sharing-dialog" aria-labelledby="sharing-title"><h2 id="sharing-title">View on another device</h2>
      <p>Share the folder currently open in Lumen with devices on your home network. Anyone with the pairing key can view its images. Desktop filters do not limit sharing.</p>
      <button disabled={busy} onClick={() => void change(!state.active)}>{state.active ? 'Stop sharing' : 'Start sharing'}</button>
      {state.active && <><p>Open <b>https://jamesiv4.github.io/image-directory-viewer/</b> in Chrome or Edge on your other device. Allow local-network access, then enter:</p><label>PC address<select aria-label="PC sharing address">{state.addresses.map(address => <option key={address}>{address}</option>)}</select></label>
        {!state.addresses.length && <p>No network address found. Connect your PC to Wi-Fi or Ethernet.</p>}
        <label>Pairing key<input aria-label="Pairing key" readOnly value={state.token} onFocus={event => event.target.select()} /></label>
        <p>Both devices must be on the same network. If Windows asks, allow Lumen on private networks. Keep Lumen open. You can also open the PC address directly in a browser.</p></>}
      {error && <p role="alert">{error}</p>}<button onClick={() => setVisible(false)}>Close</button></dialog>}
  </>;
}
