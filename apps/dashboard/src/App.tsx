import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { AdminAuthProvider } from './contexts/AdminAuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminProtectedRoute from './components/admin/AdminProtectedRoute'
import DashboardLayout from './components/DashboardLayout'
import AdminLayout from './components/admin/AdminLayout'
import LoginSaaS from './pages/LoginSaaS'
import RegisterSaaS from './pages/RegisterSaaS'
import OnboardingProfile from './pages/OnboardingProfile'
import DashboardHome from './pages/DashboardHome'
import FaqManager from './pages/FaqManager'
import KnowledgeManager from './pages/KnowledgeManager'
import WhatsAppConnect from './pages/WhatsAppConnect'
import ConversationInbox from './pages/ConversationInbox'
import OrderManager from './pages/OrderManager'
import PaymentVerification from './pages/PaymentVerification'
import CODOrders from './pages/CODOrders'
import AiSettings from './pages/AiSettings'
import ProfilePage from './pages/ProfilePage'
import ProductsPage from './pages/ProductsPage'
import AnalyticsPage from './pages/AnalyticsPage'
import AdminLogin from './pages/admin/AdminLogin'
import AdminOverview from './pages/admin/AdminOverview'
import StoreManagement from './pages/admin/StoreManagement'
import AdminGOWA from './pages/admin/AdminGOWA'
import PlatformConfig from './pages/admin/PlatformConfig'
import AIProviders from './pages/admin/AIProviders'
import AuditLogViewer from './pages/admin/AuditLogViewer'
import BackupManagement from './pages/admin/BackupManagement'
import AnalyticsDashboard from './pages/admin/AnalyticsDashboard'
import { AdminProductsPage } from './pages/admin/AdminProductsPage'
import { ProductDetailPage } from './pages/admin/ProductDetailPage'
import MagicPastePage from './pages/admin/MagicPastePage'

function App() {
  return (
    <AuthProvider>
      <AdminAuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LoginSaaS />} />
          <Route path="/register" element={<RegisterSaaS />} />

          {/* Onboarding — protected but doesn't go through ProtectedRoute's profile check */}
          <Route path="/onboarding" element={<OnboardingProfile />} />

          {/* Admin routes — separate auth */}
          <Route path="/admin/login" element={<AdminLogin />} />

          <Route path="/admin" element={
            <AdminProtectedRoute>
              <AdminLayout />
            </AdminProtectedRoute>
          }>
            <Route index element={<AdminOverview />} />
            <Route path="stores" element={<StoreManagement />} />
            <Route path="gowa" element={<AdminGOWA />} />
            <Route path="products" element={<AdminProductsPage />} />
            <Route path="products/magic-paste" element={<MagicPastePage />} />
            <Route path="products/:productId" element={<ProductDetailPage />} />
            <Route path="config" element={<PlatformConfig />} />
            <Route path="ai-providers" element={<AIProviders />} />
            <Route path="analytics" element={<AnalyticsDashboard />} />
            <Route path="audit-logs" element={<AuditLogViewer />} />
            <Route path="backups" element={<BackupManagement />} />
          </Route>

          {/* Protected routes — wrapped in DashboardLayout */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<DashboardHome />} />
            <Route path="faq" element={<FaqManager />} />
            <Route path="knowledge" element={<KnowledgeManager />} />
            <Route path="whatsapp" element={<WhatsAppConnect />} />
            <Route path="conversations" element={<ConversationInbox />} />
            <Route path="orders" element={<OrderManager />} />
            <Route path="payment-verification" element={<PaymentVerification />} />
            <Route path="cod-orders" element={<CODOrders />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="ai-settings" element={<AiSettings />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AdminAuthProvider>
    </AuthProvider>
  )
}

export default App
