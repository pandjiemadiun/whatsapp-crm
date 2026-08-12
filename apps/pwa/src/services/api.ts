import axios from 'axios'

// PWA publik (no-auth). Base URL relatif '/api':
//  - dev  : diteruskan Vite proxy -> http://localhost:3000 (api pm2)
//  - prod : resolved same-origin dengan host yang melayani PWA (qlobot.web.id)
// TIDAK ada interceptor Authorization (beda apps/dashboard yang memakai Bearer token).
const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

export default api
