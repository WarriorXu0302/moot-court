import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { TaskHint } from '@/components/task-hint';
import { AuthSync } from '@/components/auth-sync';

export const metadata: Metadata = {
  title: {
    default: '模拟法庭教学系统',
    template: '%s | 模拟法庭教学系统',
  },
  description: '教师端与学生端打通的模拟法庭训练平台，支持法庭调查、法庭辩论等全流程模拟训练。',
  keywords: ['模拟法庭', '法律教育', '法庭辩论', '实践教学'],
  authors: [{ name: 'Court Simulation' }],
  robots: {
    index: true,
    follow: true,
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem('court-sim-storage');if(!raw)return;var j=JSON.parse(raw);var s=j.state;if(!s)return;if(!j.version){if(s.theme==='warm')s.theme='light-gray';if(s.fontSize==='large')s.fontSize='medium';}var d=document.documentElement;var T=['light-gray','warm','forest','navy','rice'];var F=['yahei','heiti','songti'];var S=['small','medium','large','xlarge'];if(T.indexOf(s.theme)>=0)d.setAttribute('data-theme',s.theme);if(F.indexOf(s.font)>=0)d.setAttribute('data-font',s.font);if(S.indexOf(s.fontSize)>=0)d.setAttribute('data-fontsize',s.fontSize);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeProvider>
          {isDev && <Inspector />}
          {children}
          <TaskHint />
          <AuthSync />
        </ThemeProvider>
      </body>
    </html>
  );
}
