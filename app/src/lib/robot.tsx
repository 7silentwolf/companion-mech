// WebSocket link to the robot. Protocol: kb/docs/app-robot-protocol.md
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Skill } from './types';

export const PROTOCOL_VERSION = 1;
const ACK_TIMEOUT_MS = 4000;
const PING_EVERY_MS = 1000;
const SILENCE_LIMIT_MS = 4000;

export type ConnState = 'disconnected' | 'connecting' | 'connected';
export type RobotRunState = 'idle' | 'playing' | 'estop';

export interface RobotInfo {
  robot_id?: string;
  fw?: string;
  proto?: number;
}

export interface RobotStatus {
  state: RobotRunState;
  mode?: string;
  skill?: string;
  angles: Record<string, number>;
  estop_button?: boolean;
}

interface Pending {
  resolve: (msg: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RobotValue {
  conn: ConnState;
  info: RobotInfo;
  status: RobotStatus | null;
  log: string[];
  connect: (host: string, port: number) => void;
  disconnect: () => void;
  /** Send a command and wait for the robot's ack. Rejects on error/timeout. */
  request: (msg: Record<string, unknown>) => Promise<any>;
  /** Fire-and-forget (used for fast slider updates). */
  send: (msg: Record<string, unknown>) => boolean;
  estop: () => boolean;
  play: (skill: Skill) => Promise<any>;
  putFile: (path: string, content: unknown) => Promise<any>;
}

const RobotContext = createContext<RobotValue | null>(null);

export function RobotProvider({ children }: { children: ReactNode }) {
  const [conn, setConn] = useState<ConnState>('disconnected');
  const [info, setInfo] = useState<RobotInfo>({});
  const [status, setStatus] = useState<RobotStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const ws = useRef<WebSocket | null>(null);
  const nextId = useRef(1);
  const pending = useRef(new Map<number, Pending>());
  const lastHeard = useRef(0);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((line: string) => {
    const t = new Date().toLocaleTimeString();
    setLog((l) => [`${t}  ${line}`, ...l].slice(0, 100));
  }, []);

  const failAll = useCallback((why: string) => {
    pending.current.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(why));
    });
    pending.current.clear();
  }, []);

  const cleanup = useCallback(() => {
    if (pingTimer.current) clearInterval(pingTimer.current);
    pingTimer.current = null;
    const s = ws.current;
    ws.current = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close();
      } catch {}
    }
    failAll('Disconnected');
    setConn('disconnected');
  }, [failAll]);

  const rawSend = useCallback((msg: Record<string, unknown>) => {
    const s = ws.current;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    s.send(JSON.stringify(msg));
    return true;
  }, []);

  const handleMessage = useCallback(
    (text: string) => {
      lastHeard.current = Date.now();
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        addLog(`bad message: ${text.slice(0, 60)}`);
        return;
      }
      switch (msg.type) {
        case 'hello':
          setInfo({ robot_id: msg.robot_id, fw: msg.fw, proto: msg.proto });
          addLog(`robot ${msg.robot_id ?? '?'} fw ${msg.fw ?? '?'}`);
          if (msg.proto !== PROTOCOL_VERSION) addLog(`warning: robot protocol ${msg.proto}, app ${PROTOCOL_VERSION}`);
          break;
        case 'status':
          setStatus({
            state: msg.state,
            mode: msg.mode,
            skill: msg.skill,
            angles: msg.angles ?? {},
            estop_button: msg.estop_button,
          });
          break;
        case 'ack': {
          const p = pending.current.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            pending.current.delete(msg.id);
            msg.ok === false ? p.reject(new Error(msg.error ?? 'Robot refused')) : p.resolve(msg);
          }
          if (msg.ok === false) addLog(`error: ${msg.error}`);
          break;
        }
        case 'done':
          addLog(`finished ${msg.skill_id ?? 'skill'}`);
          break;
        case 'event':
          addLog(`event: ${msg.name}`);
          break;
        case 'error':
          addLog(`robot error: ${msg.error ?? msg.msg}`);
          break;
      }
    },
    [addLog],
  );

  const connect = useCallback(
    (host: string, port: number) => {
      cleanup();
      const url = `ws://${host.trim()}:${port}`;
      addLog(`connecting to ${url}`);
      setConn('connecting');
      let s: WebSocket;
      try {
        s = new WebSocket(url);
      } catch (e: any) {
        addLog(`cannot connect: ${e?.message ?? e}`);
        setConn('disconnected');
        return;
      }
      ws.current = s;
      s.onopen = () => {
        setConn('connected');
        lastHeard.current = Date.now();
        addLog('connected');
        rawSend({ type: 'hello', app: 'mechakin', proto: PROTOCOL_VERSION });
        pingTimer.current = setInterval(() => {
          if (Date.now() - lastHeard.current > SILENCE_LIMIT_MS) {
            addLog('robot stopped answering');
            cleanup();
            return;
          }
          rawSend({ type: 'ping' });
        }, PING_EVERY_MS);
      };
      s.onmessage = (e) => handleMessage(String(e.data));
      s.onerror = () => addLog('connection error (check IP, same Wi-Fi, robot powered)');
      s.onclose = () => {
        addLog('disconnected');
        cleanup();
      };
    },
    [addLog, cleanup, handleMessage, rawSend],
  );

  const request = useCallback((msg: Record<string, unknown>) => {
    return new Promise<any>((resolve, reject) => {
      const id = nextId.current++;
      if (!rawSend({ ...msg, id })) {
        reject(new Error('Not connected to robot'));
        return;
      }
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error('Robot did not answer'));
      }, ACK_TIMEOUT_MS);
      pending.current.set(id, { resolve, reject, timer });
    });
  }, [rawSend]);

  const estop = useCallback(() => {
    const ok = rawSend({ type: 'estop' });
    addLog(ok ? 'E-STOP sent' : 'E-STOP: not connected! Use the robot button / unplug power');
    return ok;
  }, [rawSend, addLog]);

  const play = useCallback((skill: Skill) => request({ type: 'play', skill }), [request]);

  const putFile = useCallback(
    (path: string, content: unknown) => request({ type: 'put_file', path, content: JSON.stringify(content) }),
    [request],
  );

  useEffect(() => cleanup, [cleanup]);

  const value = useMemo(
    () => ({ conn, info, status, log, connect, disconnect: cleanup, request, send: rawSend, estop, play, putFile }),
    [conn, info, status, log, connect, cleanup, request, rawSend, estop, play, putFile],
  );
  return <RobotContext.Provider value={value}>{children}</RobotContext.Provider>;
}

export function useRobot(): RobotValue {
  const v = useContext(RobotContext);
  if (!v) throw new Error('useRobot outside RobotProvider');
  return v;
}
