# Website

Desktop web entrypoint for Expo web export.

The root `App.web.js` points here, so website builds avoid importing the mobile
auth shell. Routes such as `/login`, `/settings`, `/study`, `/subjects`,
`/friends`, `/chats`, and `/chats/:id` are handled here and by static host
rewrites.
