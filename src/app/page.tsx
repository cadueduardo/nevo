import dynamic from 'next/dynamic'

const LandingChat = dynamic(
  () => import('@/components/onboarding/LandingChat').then((mod) => mod.LandingChat),
  {
    ssr: false,
    loading: () => <div className="min-h-screen bg-background" />,
  }
)

export default function HomePage() {
  return <LandingChat />
}
