<script setup>
import { store } from '../store.js';
</script>

<template>
	<header class="sticky top-0 z-20 flex h-11 items-center border-b border-neutral-300 bg-linear-to-b from-white to-neutral-200 px-3 lg:hidden">
		<button class="rounded px-2 py-1 text-neutral-600 hover:bg-white" aria-label="Open navigation" @click="store.sidebarOpen = true">☰</button>
	</header>
</template>
