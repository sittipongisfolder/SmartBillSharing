import React from 'react'
import Link from 'next/link'

const Navbar = () => {
  return (
    <nav className="bg-gray-800 text-white p-4">
      <div className="container mx-auto flex justify-between items-center">
        <div className="text-2xl font-bold">
            <h1 className="text-white-400">จ่ายด้วย</h1>
        </div>
        <ul className="flex space-x-6">
          <li>
            <Link href="/login">
              <h1 className="hover:text-blue-400">Login</h1>
            </Link>
          </li>
          <li>
            <Link href="/register">
              <h1 className="hover:text-blue-400">Register</h1>
            </Link>
          </li>
        </ul>
      </div>    
    </nav>
  )
}

export default Navbar
