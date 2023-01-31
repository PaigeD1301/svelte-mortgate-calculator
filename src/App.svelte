<script>
  // convert number to currency format
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  let homeValue = 600000;
  let downPayment = 100000;
  $: principle = homeValue - downPayment;
  let years = 30;
  let rateInput = 4.5;
  let monthlyPayment;
  let total;
  let totalInterest;

  function calculatePayment() {
    let rate = rateInput / 100 / 12;
    let numOfPayment = years * 12;

    monthlyPayment =
      (principle * rate * Math.pow(1 + rate, numOfPayment)) /
      (Math.pow(1 + rate, numOfPayment) - 1);

    total = monthlyPayment * numOfPayment;
    totalInterest = total - principle;
  }
</script>

<main class="hero">
  <div class="container">
    <h1>Mortgate Calculator</h1>

    <div class="input-field">
      <label>Home Value</label>
      <input type="number" bind:value={homeValue} />
    </div>
    <div class="input-field">
      <label>Down Payment</label>
      <input type="number" bind:value={downPayment} />
    </div>
    <div class="input-field">
      <label>Loan Amount</label>
      <input type="number" bind:value={principle} />
    </div>
    <div class="input-field">
      <label for="">Loan Term (years)</label>
      <input type="number" bind:value={years} />
    </div>
    <div class="input-field">
      <label>Interest Rate (%)</label>
      <input type="number" step="0.1" bind:value={rateInput} />
    </div>

    <div class="btn-container">
      <button class="btn" on:click={calculatePayment}>CALCULATE</button>

      {#if monthlyPayment}
        <button class="outputs">
          MONTHLY PAYMENT: {formatter.format(monthlyPayment)}
        </button>
        <!-- <div class="outputs">
			Total Interest: {formatter.format(totalInterest)}
		</div>
		<div class="outputs">
			Total: {formatter.format(total)}
		</div> -->
      {/if}
    </div>
  </div>
</main>
