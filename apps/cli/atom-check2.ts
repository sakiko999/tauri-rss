import { parseFeed } from "../../packages/xml/src/xml-parser.ts"

const one = `<feed><entry><title>x</title><link rel="alternate" type="text/html" href="https://a.example/post"/></entry></feed>`
console.log("SINGLE link =", JSON.stringify(parseFeed(one).channel.item[0].link))

const two = `<feed><entry><title>x</title><link rel="self" href="https://s"/><link rel="alternate" type="text/html" href="https://a.example/post"/></entry></feed>`
console.log("MULTI  link =", JSON.stringify(parseFeed(two).channel.item[0].link))
