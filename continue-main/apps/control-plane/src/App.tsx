import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Shield, LayoutDashboard, Settings, Activity, Clock, LogOut, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

function Sidebar() {
  const location = useLocation();
  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Approvals', path: '/approvals', icon: Shield },
    { name: 'Audit Logs', path: '/logs', icon: Activity },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <aside className="w-64 border-r border-[#1a1a1a] bg-[#0a0a0a] h-screen fixed left-0 top-0 flex flex-col text-[#a1a1a1]">
      <div className="p-6 flex items-center gap-3 border-b border-[#1a1a1a]">
        <Shield className="w-8 h-8 text-blue-500" />
        <span className="font-semibold text-white tracking-wide text-lg">AI Firewall</span>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
                isActive 
                  ? 'bg-blue-500/10 text-blue-500 font-medium' 
                  : 'hover:bg-[#1a1a1a] hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-[#1a1a1a]">
        <button className="flex items-center gap-3 px-3 py-2.5 rounded-md w-full hover:bg-[#1a1a1a] hover:text-white transition-colors">
          <LogOut className="w-5 h-5" />
          Logout
        </button>
      </div>
    </aside>
  );
}

function Dashboard() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Overview</h1>
        <p className="text-[#a1a1a1] mt-1">Real-time security analytics and AI firewall metrics.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <CheckCircle2 className="w-16 h-16 text-emerald-500" />
          </div>
          <h3 className="text-[#a1a1a1] font-medium">Allowed Requests</h3>
          <p className="text-3xl font-bold text-white mt-2">12,402</p>
          <div className="mt-4 flex items-center text-sm text-emerald-500">
            <Activity className="w-4 h-4 mr-1" />
            <span>+14% from last week</span>
          </div>
        </div>

        <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <XCircle className="w-16 h-16 text-rose-500" />
          </div>
          <h3 className="text-[#a1a1a1] font-medium">Blocked Threats</h3>
          <p className="text-3xl font-bold text-white mt-2">142</p>
          <div className="mt-4 flex items-center text-sm text-rose-500">
            <Activity className="w-4 h-4 mr-1" />
            <span>+24% from last week</span>
          </div>
        </div>

        <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Clock className="w-16 h-16 text-blue-500" />
          </div>
          <h3 className="text-[#a1a1a1] font-medium">Pending Approvals</h3>
          <p className="text-3xl font-bold text-white mt-2">3</p>
          <div className="mt-4 flex items-center text-sm text-blue-500">
            <Shield className="w-4 h-4 mr-1" />
            <span>Requires attention</span>
          </div>
        </div>
      </div>

      {/* Recent Alerts Table */}
      <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1a1a1a]">
          <h3 className="text-white font-medium">Recent Interceptions</h3>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#1a1a1a] text-sm text-[#a1a1a1]">
              <th className="px-6 py-3 font-medium">Time</th>
              <th className="px-6 py-3 font-medium">Action</th>
              <th className="px-6 py-3 font-medium">Reason</th>
              <th className="px-6 py-3 font-medium">User</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            <tr className="border-b border-[#1a1a1a]/50 hover:bg-[#1a1a1a]/50 transition-colors">
              <td className="px-6 py-4 text-[#a1a1a1]">2 mins ago</td>
              <td className="px-6 py-4"><span className="inline-flex items-center px-2 py-1 rounded-md bg-yellow-500/10 text-yellow-500 text-xs font-medium"><AlertTriangle className="w-3 h-3 mr-1" />REDACT</span></td>
              <td className="px-6 py-4 text-white">AWS Secret Key Detected</td>
              <td className="px-6 py-4 text-[#a1a1a1]">alice@corp.com</td>
            </tr>
            <tr className="border-b border-[#1a1a1a]/50 hover:bg-[#1a1a1a]/50 transition-colors">
              <td className="px-6 py-4 text-[#a1a1a1]">15 mins ago</td>
              <td className="px-6 py-4"><span className="inline-flex items-center px-2 py-1 rounded-md bg-rose-500/10 text-rose-500 text-xs font-medium"><XCircle className="w-3 h-3 mr-1" />BLOCK</span></td>
              <td className="px-6 py-4 text-white">Prompt Injection Attempt</td>
              <td className="px-6 py-4 text-[#a1a1a1]">bob@corp.com</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Approvals() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Pending Approvals</h1>
        <p className="text-[#a1a1a1] mt-1">Review intercepted requests requiring manual override.</p>
      </header>
      
      <div className="grid gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="bg-[#111111] border border-[#1a1a1a] p-5 rounded-xl flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  Tool Execution
                </span>
                <span className="text-sm text-[#a1a1a1]">10 minutes ago</span>
              </div>
              <h3 className="text-white font-medium mt-3 text-lg">Read File: `production_keys.env`</h3>
              <p className="text-[#a1a1a1] mt-1 text-sm">Hithesh Reddy requested access to a high-risk file.</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button className="px-4 py-2 text-sm font-medium text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a] rounded-md transition-colors border border-[#1a1a1a]">
                Reject
              </button>
              <button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors shadow-lg shadow-blue-500/20">
                Approve Request
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex font-sans selection:bg-blue-500/30">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
