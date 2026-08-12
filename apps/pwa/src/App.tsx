import { Routes, Route } from 'react-router-dom'
import ChatPage from './components/ChatPage'
import NotFound from './components/NotFound'

// PWA publik (no-auth). Routing: /c/:slug -> chat toko. Path lain -> NotFound.
export default function App() {
  return (
    <Routes>
      <Route path="/c/:slug" element={<ChatPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
