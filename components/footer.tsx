'use client'

import { useState } from 'react'
import { MessageCircle, X, Send } from 'lucide-react'

export default function Footer() {
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim() || !email.trim()) return
    // For now, mailto fallback — replace with API endpoint later
    const subject = encodeURIComponent('MillSuite Feedback')
    const body = encodeURIComponent(`${message}\n\n—\nFrom: ${email || 'Not provided'}`)
    window.open(`mailto:info@millsuite.com?subject=${subject}&body=${body}`, '_self')
    setSent(true)
    setTimeout(() => { setSent(false); setShowForm(false); setMessage(''); setEmail('') }, 3000)
  }

  return (
    <>
      {/* Feedback button */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="fixed bottom-20 right-5 w-11 h-11 bg-[#2563EB] text-white rounded-full shadow-lg hover:bg-[#1D4ED8] transition-all flex items-center justify-center z-50"
        title="Send feedback"
      >
        {showForm ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>

      {/* Feedback form */}
      {showForm && (
        <div className="fixed bottom-[8.5rem] right-5 w-80 bg-white border border-[#E5E7EB] rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E5E7EB]">
            <div className="text-sm font-semibold text-[#111]">Send Feedback</div>
            <div className="text-[10px] text-[#9CA3AF]">Bug reports, feature requests, or questions</div>
          </div>
          {sent ? (
            <div className="px-4 py-8 text-center">
              <div className="text-sm font-medium text-[#059669]">Thanks for the feedback!</div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Your email"
                required
                className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="What's on your mind?"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={!message.trim() || !email.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            </form>
          )}
        </div>
      )}

      {/* Footer bar */}
      <footer className="border-t border-[#E5E7EB] bg-white mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight text-[#111]">MillSuite</span>
            <span className="text-xs text-[#9CA3AF]">Project Profit Tracker</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-[#9CA3AF]">
            <a href="mailto:info@millsuite.com" className="hover:text-[#6B7280] transition-colors">info@millsuite.com</a>
            <span>·</span>
            <a href="https://millsuite.com" target="_blank" rel="noopener noreferrer" className="hover:text-[#6B7280] transition-colors">millsuite.com</a>
          </div>
        </div>
      </footer>
    </>
  )
}
