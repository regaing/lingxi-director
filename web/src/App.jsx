import React from 'react';
import { I18nProvider } from './i18n.jsx';
import { useHashRoute } from './router.js';
import Home from './pages/Home.jsx';
import Editor from './pages/Editor.jsx';

export default function App() {
  const hash = useHashRoute();
  const m = hash.match(/^#\/wf\/([^/?#]+)/);

  return (
    <I18nProvider>
      {m ? <Editor id={decodeURIComponent(m[1])} /> : <Home />}
    </I18nProvider>
  );
}
