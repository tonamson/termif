import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')

// AppRoot arrives in Task 5; this keeps the shell launchable from Task 1 on.
createRoot(root).render(<div>Termif</div>)
