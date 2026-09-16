import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey } from '@/lib/api-key'
import { prisma } from '@/lib/db'
import { bridgeManager } from '@/lib/bridge'

export async function POST(request: NextRequest) {
  try {
    const userId = await validateApiKey(request.headers.get('authorization'))
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { path, content } = await request.json()

    if (!path || !content) {
      return NextResponse.json({ error: 'Path and content required' }, { status: 400 })
    }

    // Get first online device for user
    const device = await prisma.device.findFirst({
      where: {
        userId,
        status: 'online'
      }
    })

    if (!device) {
      return NextResponse.json(
        { error: 'No active Mastermind device is online.' },
        { status: 503 }
      )
    }

    // Call tool on device
    const result = await bridgeManager.callTool(device.id, 'append_note', {
      path,
      content
    })

    // Log tool call
    await prisma.toolCallLog.create({
      data: {
        userId,
        deviceId: device.id,
        toolName: 'append_note',
        status: 'success',
        inputJson: JSON.stringify({ path, content })
      }
    })

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
