import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import loginHintIcon from '../assets/login-hint-icon.svg';
import {
  UnauthorizedError,
  api,
  clearAuthToken,
  hasAuthToken,
  setAuthToken
} from '../lib/api';

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [authReady, setAuthReady] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    void bootstrapAuth();
  }, []);

  async function bootstrapAuth() {
    setAuthReady(false);
    setAuthMessage('');

    try {
      const status = await api.getAuthStatus();
      setAuthConfigured(status.configured);

      if (status.configured && hasAuthToken()) {
        try {
          await api.getSettings();
          await navigate({ to: '/' });
          return;
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            clearAuthToken();
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      const text = `认证初始化失败: ${errorMessage(error)}`;
      setAuthMessage(text);
      toast.error(text);
      clearAuthToken();
    } finally {
      setAuthReady(true);
    }
  }

  async function onSetupPassword() {
    if (authPassword !== authPasswordConfirm) {
      const text = '两次输入的密码不一致';
      setAuthMessage(text);
      toast.error(text);
      return;
    }

    setAuthSubmitting(true);
    setAuthMessage('');
    try {
      const resp = await api.setupPassword(authPassword);
      setAuthToken(resp.token);
      setAuthPassword('');
      setAuthPasswordConfirm('');
      await navigate({ to: '/' });
    } catch (error) {
      const text = `设置失败: ${errorMessage(error)}`;
      setAuthMessage(text);
      toast.error(text);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function onLogin() {
    setAuthSubmitting(true);
    setAuthMessage('');
    try {
      const resp = await api.login(authPassword);
      setAuthToken(resp.token);
      setAuthPassword('');
      await navigate({ to: '/' });
    } catch (error) {
      const text = `登录失败: ${errorMessage(error)}`;
      setAuthMessage(text);
      toast.error(text);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authSubmitting) {
      return;
    }
    if (authConfigured) {
      await onLogin();
      return;
    }
    await onSetupPassword();
  }

  if (!authReady) {
    return (
      <div className="login-shell">
        <div className="login-grid">
          <section className="shell-panel surface-card flex min-h-[320px] items-center justify-center rounded-[1.8rem] p-8">
            <p className="font-mono text-sm text-slate">正在检查访问权限...</p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-grid">
        <section className="shell-panel surface-card hidden rounded-[2rem] p-8 lg:flex lg:flex-col lg:justify-between">
          <div className="space-y-5">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-pine/30 bg-pine/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-pine">
              <ShieldCheck className="h-4 w-4" />
              Secure Access
            </div>

            <div className="space-y-3">
              <p className="section-title">F2 Web Console</p>
              <h1 className="font-display text-5xl font-semibold leading-[0.92] tracking-[-0.06em] text-ink">
                抖音数据备份的统一操作台
              </h1>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="ops-chip">
                <strong>任务</strong>
                <span>执行</span>
              </span>
              <span className="ops-chip">
                <strong>计划</strong>
                <span>调度</span>
              </span>
              <span className="ops-chip">
                <strong>设置</strong>
                <span>管理</span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-sm text-slate">
            <span>密码鉴权</span>
            <span>实时日志</span>
            <span>目录校验</span>
          </div>
        </section>

        <section className="shell-panel surface-card flex rounded-[2rem] p-6 sm:p-8">
          <div className="mx-auto flex w-full max-w-md flex-col justify-between">
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <p className="section-title">Access Gate</p>
                  <h2 className="font-display text-3xl font-semibold tracking-[-0.05em] text-ink">
                    {authConfigured ? '进入控制台' : '初始化控制台'}
                  </h2>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-[1.4rem] border border-pine/30 bg-pine/10">
                  <img src={loginHintIcon} alt="应用 Logo" className="h-8 w-8 object-contain" />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-sm text-slate">
                <span className="ops-chip">
                  <strong>{authConfigured ? '登录' : '初始化'}</strong>
                  <span>入口</span>
                </span>
                <span className="ops-chip">
                  <strong>Bearer</strong>
                  <span>Token</span>
                </span>
              </div>
            </div>

            <form className="mt-8 grid gap-4" onSubmit={(event) => void onSubmit(event)}>
              <label className="block text-sm text-slate">
                <span className="subtle-label">访问密码</span>
                <Input
                  type="password"
                  className="mt-2"
                  autoComplete={authConfigured ? 'current-password' : 'new-password'}
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder={authConfigured ? '输入访问密码' : '至少 6 位字符'}
                  required
                />
              </label>

              {!authConfigured && (
                <label className="block text-sm text-slate">
                  <span className="subtle-label">确认密码</span>
                  <Input
                    type="password"
                    className="mt-2"
                    autoComplete="new-password"
                    value={authPasswordConfirm}
                    onChange={(event) => setAuthPasswordConfirm(event.target.value)}
                    placeholder="再次输入密码"
                    required
                  />
                </label>
              )}

              <div className="flex flex-col gap-3 pt-2">
                <Button className="w-full" type="submit" size="lg" disabled={authSubmitting}>
                  {authConfigured
                    ? authSubmitting
                      ? '登录中...'
                      : '进入控制台'
                    : authSubmitting
                      ? '设置中...'
                      : '设置并登录'}
                </Button>

                {authMessage ? (
                  <p className="status-banner text-sm">{authMessage}</p>
                ) : (
                  <p className="text-xs leading-6 text-slate">
                    认证仅用于保护 Web 管理界面，不改变采集逻辑和下载行为。
                  </p>
                )}
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
