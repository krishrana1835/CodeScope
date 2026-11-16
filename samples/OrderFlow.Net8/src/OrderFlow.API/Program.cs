using OrderFlow.BusinessLogic.Services;
using OrderFlow.Contracts.Interfaces;
using OrderFlow.DataAccess.Repositories;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("OrdersDb") ?? "Data Source=orders.db";

builder.Services.AddSingleton<IOrderRepository>(_ => new SqlOrderRepository(connectionString));
builder.Services.AddSingleton<ICustomerRepository>(_ => new SqlCustomerRepository(connectionString));
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddControllers();

var app = builder.Build();
app.MapControllers();
app.Run();
