import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { router } from './routes'
import { createDb } from './db'
import { createTables, seedCategories, seedTestData } from './schema'

const app = express()

app.use(cors())
app.use(express.json())

app.get('/manifest.json', (_req, res) => {
  res.json({
    name: process.env.VITE_APP_NAME ?? 'Finance',
    short_name: process.env.VITE_APP_NAME ?? 'Finance',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#6366f1',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })
})

app.use('/api', router)

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

if (require.main === module) {
  const db = createDb()
  createTables(db)
  seedCategories(db)
  seedTestData(db)
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}

export { app }
