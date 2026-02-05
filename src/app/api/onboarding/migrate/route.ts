import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)
}

async function generateUniqueSlug(supabaseAdmin: any, baseName: string, attempt = 0): Promise<string> {
  const baseSlug = generateSlug(baseName)
  const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`
  const { error } = await supabaseAdmin.from('tenant').select('id').eq('slug', slug).single()
  if (error && error.code === 'PGRST116') return slug
  if (error) throw error
  return generateUniqueSlug(supabaseAdmin, baseName, attempt + 1)
}

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json()
    if (!session_id) {
      return NextResponse.json({ error: 'session_id é obrigatório' }, { status: 400 })
    }

    const serverClient = await createServerClient()
    const { data: userData, error: userError } = await serverClient.auth.getUser()
    if (userError || !userData?.user) {
      return NextResponse.json({ error: 'Usuário não autenticado' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Configuração do servidor incompleta' }, { status: 500 })
    }

    const supabaseAdmin = createAdminClient(supabaseUrl, serviceRoleKey)

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('onboarding_sessions')
      .select('collected_data')
      .eq('session_id', session_id)
      .single()
    if (sessionError || !session) {
      return NextResponse.json({ error: 'Sessão de onboarding não encontrada' }, { status: 404 })
    }

    const collected = session.collected_data || {}
    if (!collected.business_name) {
      return NextResponse.json({ error: 'Nome do negócio não encontrado na sessão' }, { status: 400 })
    }

    const userId = userData.user.id
    const tenantSlug = await generateUniqueSlug(supabaseAdmin, collected.business_name)

    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenant')
      .insert({ name: collected.business_name, slug: tenantSlug })
      .select()
      .single()
    if (tenantError) {
      return NextResponse.json({ error: `Erro ao criar tenant: ${tenantError.message}` }, { status: 500 })
    }

    const tenantId = tenantData.id
    const { error: tenantUserError } = await supabaseAdmin.from('tenant_user').insert({
      tenant_id: tenantId,
      user_id: userId,
      role: 'owner',
    })
    if (tenantUserError) {
      await supabaseAdmin.from('tenant').delete().eq('id', tenantId)
      return NextResponse.json({ error: `Erro ao criar tenant_user: ${tenantUserError.message}` }, { status: 500 })
    }

    await supabaseAdmin.from('tenant_setting').insert({
      tenant_id: tenantId,
      tone:
        collected.tone_of_voice === 'friendly'
          ? 'friendly'
          : collected.tone_of_voice === 'formal'
            ? 'formal'
            : collected.tone_of_voice === 'professional'
              ? 'professional'
              : null,
      language: 'pt-BR',
      handoff_mode: collected.handoff_mode || 'conditional',
    })

    return NextResponse.json({ success: true, tenant_id: tenantId })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro interno do servidor' }, { status: 500 })
  }
}
