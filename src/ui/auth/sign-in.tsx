import { signIn } from "../../auth.ts"
 
export function SignIn() {
  return (
    <form
      action={async (formData) => {
        "use server"
        await signIn("resend", formData)
      }}
    >
      <input type="text" name="email" placeholder="Email" />
      <button type="submit">Entrar com Email</button>
    </form>
  )
}