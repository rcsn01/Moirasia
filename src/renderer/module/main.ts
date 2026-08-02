const labels = {
  amove: 'Amove',
  vox: 'Vox',
  exithibition: 'Exithibition'
} as const

const section = document.createElement('section')
const eyebrow = document.createElement('p')
const heading = document.createElement('h1')
const copy = document.createElement('p')
eyebrow.className = 'eyebrow'
eyebrow.textContent = 'Module unavailable'
heading.textContent = labels[window.moduleInfo.id]
copy.textContent = 'Install a compatible standalone application to make this module available.'
section.append(eyebrow, heading, copy)
document.getElementById('module-root')!.append(section)
