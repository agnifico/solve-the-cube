import './styles/main.css';
import { App } from './app.ts';

function start() {
  try {
    new App();
  } catch (err) {
    console.error(err);
    document.documentElement.classList.add('is-ready', 'no-webgl');
    document.getElementById('loader')?.classList.add('is-done');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
