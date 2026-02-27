import { getAuthToken, type TaskEvent } from './api';

export function connectTaskWs(taskId: string, onEvent: (event: TaskEvent | any) => void): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const token = getAuthToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  const ws = new WebSocket(`${protocol}://${window.location.host}/ws/tasks/${taskId}${query}`);

  ws.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      // ignore malformed message
    }
  };

  return ws;
}
