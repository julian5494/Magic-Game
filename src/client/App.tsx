import { useEffect } from 'react';
import { GameBoard } from './components/GameBoard';
import { Lobby } from './components/Lobby';
import { RoomScreen } from './components/RoomScreen';
import { Showcase } from './components/Showcase';
import { useConnection } from './net';

export function App() {
  const { state, send, dismissError } = useConnection();

  useEffect(() => {
    if (!state.errors.length) return;
    const t = setTimeout(() => dismissError(state.errors[0].id), 4500);
    return () => clearTimeout(t);
  }, [state.errors, dismissError]);

  const showcase = new URLSearchParams(location.search).get('showcase');
  let screen;
  if (showcase !== null) screen = <Showcase scene={showcase} />;
  else if (!state.playerId) screen = <div className="center-msg">{state.connected ? 'Connecting…' : 'Connecting to server…'}</div>;
  else if (state.view && state.room?.started) screen = <GameBoard view={state.view} net={state} send={send} />;
  else if (state.room) screen = <RoomScreen net={state} send={send} />;
  else screen = <Lobby net={state} send={send} />;

  return (
    <>
      {screen}
      {!state.connected && state.playerId && <div className="banner">Reconnecting…</div>}
      <div className="toasts">
        {state.errors.map((e) => (
          <div key={e.id} className="toast" onClick={() => dismissError(e.id)}>
            {e.message}
          </div>
        ))}
      </div>
    </>
  );
}
