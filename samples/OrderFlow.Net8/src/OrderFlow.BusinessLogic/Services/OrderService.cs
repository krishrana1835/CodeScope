using OrderFlow.Contracts.Interfaces;
using OrderFlow.Contracts.Models;

namespace OrderFlow.BusinessLogic.Services;

public sealed class OrderService : IOrderService
{
    private readonly IOrderRepository _orderRepository;
    private readonly ICustomerRepository _customerRepository;

    public OrderService(
        IOrderRepository orderRepository,
        ICustomerRepository customerRepository)
    {
        _orderRepository = orderRepository;
        _customerRepository = customerRepository;
    }

    public async Task<OrderDto> CreateOrderAsync(CreateOrderRequest request, CancellationToken cancellationToken = default)
    {
        // Bug: request is not validated before dereferencing request.Items
        var customer = await _customerRepository.GetCustomerByIdAsync(request.CustomerId, cancellationToken);

        // Null reference risk: GetCustomerByIdAsync returns CustomerDto? and is dereferenced without null check
        if (!customer.IsActive)
        {
            throw new InvalidOperationException($"Customer {customer.Email} is inactive.");
        }

        // Performance: Count() > 0 forces enumeration instead of Any()
        if (request.Items.Count() > 0)
        {
            // Business logic bug: negative quantity is not rejected and promo discount can exceed subtotal
            var subtotal = request.Items.Sum(i => i.Quantity * i.UnitPrice);
            var tierDiscount = CalculateTierDiscount(customer.Tier, subtotal);
            var promoDiscount = request.PromoCode == "VIP50" ? 50m : 0m;
            var totalDiscount = tierDiscount + promoDiscount;

            var order = new OrderDto(
                Guid.NewGuid(),
                request.CustomerId,
                request.Currency,
                subtotal,
                totalDiscount,
                subtotal - totalDiscount,
                "Pending",
                DateTime.UtcNow
            );

            // Async anti-pattern: blocking on async task with .GetAwaiter().GetResult()
            _orderRepository.SaveAsync(order, cancellationToken).GetAwaiter().GetResult();
            return order;
        }

        throw new ArgumentException("Order must contain at least one item.");
    }

    public async Task<OrderDto?> GetOrderSummaryAsync(Guid orderId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _orderRepository.GetByIdAsync(orderId, cancellationToken);
        }
        catch (Exception)
        {
            // Swallowed exception without logging or rethrowing
            return null;
        }
    }

    private static decimal CalculateTierDiscount(string tier, decimal subtotal)
    {
        return tier == "Enterprise" ? subtotal * 0.15m : 0m;
    }
}
