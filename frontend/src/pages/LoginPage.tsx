import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
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
      <div className="flex min-h-screen items-center justify-center px-4 py-6 md:px-6">
        <section className="surface-card flex min-h-[420px] w-full max-w-md items-center justify-center rounded-2xl p-6 md:p-8">
          <p className="font-mono text-xs text-slate">正在检查访问权限...</p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-6 md:px-6">
      <section className="surface-card flex min-h-[420px] w-full max-w-md items-center rounded-2xl p-6 md:p-8">
        <div className="w-full max-w-sm mx-auto">
            <div className="mb-4 flex justify-center">
              <img src={loginHintIcon} alt="应用 Logo" className="h-16 w-16 object-contain" />
            </div>
            <p className="text-center text-sm text-slate/90">{authConfigured ? '请输入访问密码' : '首次使用请设置访问密码'}</p>

            <form className="mt-5 grid gap-3" onSubmit={(event) => void onSubmit(event)}>
              <label className="text-xs text-slate">
                密码
                <Input
                  type="password"
                  className="mt-1"
                  autoComplete={authConfigured ? 'current-password' : 'new-password'}
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder={authConfigured ? '输入访问密码' : '至少 6 位字符'}
                  required
                />
              </label>

              {!authConfigured && (
                <label className="text-xs text-slate">
                  确认密码
                  <Input
                    type="password"
                    className="mt-1"
                    autoComplete="new-password"
                    value={authPasswordConfirm}
                    onChange={(event) => setAuthPasswordConfirm(event.target.value)}
                    placeholder="再次输入密码"
                    required
                  />
                </label>
              )}

              <div className="pt-1">
                <Button className="w-full" type="submit" disabled={authSubmitting}>
                  {authConfigured ? (authSubmitting ? '登录中...' : '登录') : authSubmitting ? '设置中...' : '设置并登录'}
                </Button>
              </div>

              {authMessage && <p className="font-mono text-xs text-slate">{authMessage}</p>}
            </form>
        </div>
      </section>
    </div>
  );
}
