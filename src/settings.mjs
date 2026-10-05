export const defaults = store => ({
  runtime: store.get('runtime') ?? '30–60',
  developmentSeeds: Number(store.get('developmentSeeds') ?? 5),
  finalSeeds: Number(store.get('finalSeeds') ?? 10),
  concurrency: Number(store.get('concurrency') ?? 10),
  autoReply: store.get('autoReply') !== '0',
});

export function parseDefaults(form) {
  const runtime = form.get('runtime');
  const developmentSeeds = Number(form.get('developmentSeeds'));
  const finalSeeds = Number(form.get('finalSeeds'));
  const concurrency = Number(form.get('concurrency'));
  if (!['15–30', '30–60', '60–120'].includes(runtime) ||
      !Number.isInteger(developmentSeeds) || developmentSeeds < 1 || developmentSeeds > 100 ||
      !Number.isInteger(finalSeeds) || finalSeeds < 1 || finalSeeds > 100 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 60) {
    throw new Error('Choose a runtime and enter whole-number seeds (1–100) and concurrency (1–60).');
  }
  return { runtime, developmentSeeds, finalSeeds, concurrency };
}

export function saveDefaults(store, values) {
  for (const [key, value] of Object.entries(values)) store.set(key, value);
}
